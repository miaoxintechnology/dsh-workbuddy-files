import { homedir } from "node:os";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/host/index.ts
/**
* dsh-workbuddy-files · Host 半侧
*
* 职责：
*  1. 文件落地缓存 `~/.dsh-drops/`（保留拖入目录树结构），通过 webServer 路由
*     `/workbuddy-drops` 接收浏览器 fetch 的二进制 POST（无需 base64，支持大文件）；
*  2. 注册 `read_document` 模型工具：解析 `@"path"` / `@path` 引用并返回内容。
*
* 真实插件包的 Host 半侧运行在 DSH 的 Node 进程里（非沙箱），可以直接使用
* node:fs —— 这也是 dsh-pet 等第三方插件的标准写法（参考其 src/host/index.ts）。
*/
/** 插件行 id（与 cordis.patch.yml 的 id 一致） */
const name = "workbuddy-files";
/** 硬依赖：Web 服务器路由注册表 */
const inject = ["webServer"];
function resolveConfig(config = {}) {
	return {
		dropsDir: config.dropsDir ?? "~/.dsh-drops",
		maxFileBytes: config.maxFileBytes ?? 268435456
	};
}
function expandHome(dir) {
	if (dir === "~" || dir.startsWith("~/")) return join(homedir(), dir.slice(1));
	return dir;
}
/** 规范化相对路径：拒绝 `..`、绝对路径与控制字符（防目录穿越） */
function normRel(rel) {
	const parts = String(rel).replace(/\\/g, "/").split("/");
	const out = [];
	for (const p of parts) {
		if (p === "" || p === ".") continue;
		if (p === "..") return null;
		if (/[\u0000-\u001f"\r\n]/.test(p)) return null;
		out.push(p);
	}
	return out.join("/");
}
/** 校验最终路径仍位于 drops 根目录内（第二道防线） */
function resolveDrops(root, rel) {
	const candidate = normalize(join(root, rel));
	const rootWithSep = root.endsWith(sep) ? root : root + sep;
	if (candidate !== root && !candidate.startsWith(rootWithSep)) return void 0;
	return candidate;
}
function sendJson(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}
/** 收集请求体原始字节（流式，不设上限；上限检查在写盘前按 maxFileBytes 执行） */
function readBody(req) {
	return new Promise((resolve2, reject) => {
		const chunks = [];
		let total = 0;
		req.on("data", (c) => {
			chunks.push(c);
			total += c.length;
		});
		req.on("end", () => resolve2(Buffer.concat(chunks, total)));
		req.on("error", reject);
	});
}
/** UTF-8 可解码性 / 二进制探测（NUL 字节即二进制） */
function looksBinary(buf) {
	if (buf.includes(0)) return true;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buf);
		return false;
	} catch {
		return true;
	}
}
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	const dropsDir = resolve(expandHome(resolved.dropsDir));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/workbuddy-drops",
		handler: async (req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			const action = url.pathname.slice(16).replace(/^\/+/, "");
			try {
				if (action === "home") {
					sendJson(res, 200, {
						ok: true,
						root: dropsDir
					});
					return;
				}
				if (action === "stat") {
					const path = url.searchParams.get("path") ?? "";
					if (path === "") {
						sendJson(res, 200, {
							ok: true,
							exists: false,
							path
						});
						return;
					}
					const info = await stat(path);
					sendJson(res, 200, {
						ok: true,
						exists: true,
						path,
						type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
						size: info.isFile() ? info.size : null
					});
					return;
				}
				if (action === "list") {
					const q = (url.searchParams.get("query") ?? "").toLowerCase();
					const items = [];
					const add = (p, name, type, size) => {
						if (items.length >= 200) return;
						if (q === "" || p.toLowerCase().includes(q) || name.toLowerCase().includes(q)) items.push({
							name,
							path: p,
							type,
							size: size ?? null
						});
					};
					if (await stat(dropsDir).catch(() => null) === null) {
						sendJson(res, 200, {
							ok: true,
							items: []
						});
						return;
					}
					const batches = await readdir(dropsDir, { withFileTypes: true });
					for (const b of batches) {
						if (items.length >= 200) break;
						if (b.name === ".tmp" || b.name.charAt(0) === ".") continue;
						const bp = join(dropsDir, b.name);
						if (b.isFile()) {
							const s = await stat(bp).catch(() => null);
							add(bp, b.name, "file", s?.size);
							continue;
						}
						if (!b.isDirectory()) continue;
						const children = await readdir(bp, { withFileTypes: true }).catch(() => []);
						for (const c of children) {
							if (items.length >= 200) break;
							const cp = join(bp, c.name);
							const isDir = c.isDirectory();
							const s = isDir ? null : await stat(cp).catch(() => null);
							add(cp, c.name, isDir ? "directory" : "file", s?.size ?? void 0);
							if (isDir) {
								const sub = await readdir(cp, { withFileTypes: true }).catch(() => []);
								for (const s2 of sub) {
									if (items.length >= 200) break;
									const s2p = join(cp, s2.name);
									const s2dir = s2.isDirectory();
									const st2 = s2dir ? null : await stat(s2p).catch(() => null);
									add(s2p, s2.name, s2dir ? "directory" : "file", st2?.size ?? void 0);
								}
							}
						}
					}
					sendJson(res, 200, {
						ok: true,
						items
					});
					return;
				}
				if (action === "save" && req.method === "POST") {
					const rel = normRel(url.searchParams.get("rel") ?? "");
					const batch = normRel(url.searchParams.get("batch") ?? "") || "misc";
					if (rel === null || rel === "") {
						sendJson(res, 400, {
							ok: false,
							error: "目标路径非法"
						});
						return;
					}
					const dst = resolveDrops(dropsDir, batch + "/" + rel);
					if (dst === void 0) {
						sendJson(res, 400, {
							ok: false,
							error: "目标路径越界"
						});
						return;
					}
					const body = await readBody(req);
					if (resolved.maxFileBytes > 0 && body.length > resolved.maxFileBytes) {
						sendJson(res, 413, {
							ok: false,
							error: "文件超过大小上限 " + Math.floor(resolved.maxFileBytes / 1048576) + "MB"
						});
						return;
					}
					await mkdir(dirname(dst), { recursive: true });
					await writeFile(dst, body);
					sendJson(res, 200, {
						ok: true,
						path: dst,
						rel: batch + "/" + rel,
						root: dropsDir
					});
					return;
				}
				sendJson(res, 404, {
					ok: false,
					error: "unknown action: " + action
				});
			} catch (err) {
				sendJson(res, 500, {
					ok: false,
					error: String(err?.message ?? err)
				});
			}
		}
	}), "workbuddy: /workbuddy-drops route");
	const readDocumentTool = defineTool({
		name: "read_document",
		description: "解析并读取用户消息中拖拽/粘贴/@ 产生的文件引用（支持 @\"C:\\path\\file.pdf\"、@path 或裸绝对路径）。文本类文件（代码、文档、数据）直接返回内容；文件夹引用返回目录树；图片、二进制与超大文件返回元数据与读取建议。",
		parameters: {
			reference: {
				type: "string",
				required: true,
				description: "文件引用：消息中的 @\"...\" 或 @... 令牌，或直接给出绝对路径"
			},
			max_chars: {
				type: "number",
				description: "文本内容返回上限（默认 60000 字符）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute: async (args) => {
			const maxChars = typeof args.max_chars === "number" && args.max_chars > 0 ? Math.floor(args.max_chars) : 6e4;
			const raw = String(args.reference ?? "").trim();
			if (raw === "") return {
				ok: false,
				error: "reference 为空"
			};
			if (raw.startsWith("dsh-drop://")) return {
				ok: false,
				error: "该引用是浏览器端零上传直引（FS Access API 句柄），发送消息时已物化到本地缓存。请用消息中的真实路径重新读取。"
			};
			let path = raw;
			if (path.charAt(0) === "@") path = path.slice(1).trim();
			if (path.length >= 2 && path.charAt(0) === "\"" && path.charAt(path.length - 1) === "\"") path = path.slice(1, -1);
			path = path.replace(/\/+$/, "");
			try {
				const info = await stat(path);
				const base = path.split(/[\\/]/).pop();
				if (info.isDirectory()) {
					const entries = await readdir(path, { withFileTypes: true });
					const tree = entries.slice(0, 300).map(async (e) => {
						const st = e.isFile() ? await stat(join(path, e.name)).catch(() => null) : null;
						return {
							name: e.name,
							type: e.isDirectory() ? "directory" : "file",
							size: st?.size ?? null
						};
					});
					return {
						ok: true,
						path,
						name: base,
						kind: "directory",
						entries: await Promise.all(tree),
						truncated: entries.length > 300
					};
				}
				if (!info.isFile()) return {
					ok: false,
					error: "目标不是普通文件: " + path
				};
				const size = info.size;
				if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(base ?? "")) return {
					ok: true,
					path,
					name: base,
					kind: "image",
					size,
					hint: "图片文件：请使用 read_image 工具以该路径直接查看。"
				};
				if (size > 15e5) return {
					ok: true,
					path,
					name: base,
					kind: "large",
					size,
					hint: "文件过大，未内联内容；可请用户拆分，或用支持分块读取的工具处理。"
				};
				const buf = await readFile(path);
				if (looksBinary(buf)) return {
					ok: true,
					path,
					name: base,
					kind: "binary",
					size,
					hint: "二进制文件。若为常见格式，可询问用户或用宿主工具转换后读取。"
				};
				let content = buf.toString("utf8");
				const truncated = content.length > maxChars;
				if (truncated) content = content.slice(0, maxChars);
				return {
					ok: true,
					path,
					name: base,
					kind: "text",
					size,
					content,
					truncated
				};
			} catch (err) {
				if (err?.code === "ENOENT") return {
					ok: false,
					error: "路径不存在: " + path
				};
				return {
					ok: false,
					error: String(err?.message ?? err)
				};
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: "读取引用文件",
			kind: "read",
			rawInput: String(args.reference ?? "")
		})
	});
	const tools = ctx.get("tools");
	ctx.effect(() => tools !== void 0 ? tools.register(readDocumentTool) : (() => {}), "workbuddy: read_document tool");
	console.log("[workbuddy-files] host 就绪：drops 缓存 " + dropsDir + "（/workbuddy-drops 路由）+ read_document 工具");
}
//#endregion
export { apply, inject, name };

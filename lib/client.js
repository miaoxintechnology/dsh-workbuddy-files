(function() {
	//#region src/client/lib/icons.ts
	/** 文件类型 → 图标/颜色映射（WorkBuddy 风格的类型标识） */
	const ICONS = {
		pdf: "📕",
		doc: "📘",
		docx: "📘",
		xls: "📊",
		xlsx: "📊",
		csv: "📊",
		ppt: "📙",
		pptx: "📙",
		png: "🖼️",
		jpg: "🖼️",
		jpeg: "🖼️",
		gif: "🖼️",
		webp: "🖼️",
		svg: "🖼️",
		bmp: "🖼️",
		zip: "🗜️",
		"7z": "🗜️",
		rar: "🗜️",
		tar: "🗜️",
		gz: "🗜️",
		mp3: "🎵",
		wav: "🎵",
		flac: "🎵",
		mp4: "🎬",
		mov: "🎬",
		mkv: "🎬",
		md: "📝",
		txt: "📄",
		log: "📄",
		js: "💻",
		ts: "💻",
		jsx: "💻",
		tsx: "💻",
		py: "💻",
		go: "💻",
		rs: "💻",
		java: "💻",
		c: "💻",
		h: "💻",
		cpp: "💻",
		cs: "💻",
		json: "💻",
		yaml: "💻",
		yml: "💻",
		toml: "💻",
		sh: "💻",
		ps1: "💻",
		bat: "💻",
		css: "💻",
		html: "💻",
		vue: "💻",
		sql: "💻"
	};
	function iconFor(name) {
		const dot = String(name).lastIndexOf(".");
		const ext = dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : "";
		return ICONS[ext] ?? "📄";
	}
	function formatSize(n) {
		if (n === null || n === void 0 || !Number.isFinite(n)) return "";
		if (n < 1024) return n + " B";
		if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
		if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
		return (n / 1073741824).toFixed(2) + " GB";
	}
	//#endregion
	//#region src/client/lib/transfer.ts
	/** 引用文本格式：无空格直接 @path；含空格/引号用 @"path"；目录保留尾斜杠 */
	function mentionFor(path, isDir) {
		let p = String(path);
		if (isDir) p = p.replace(/[\\/]+$/, "") + "/";
		if (/\s|"/.test(p)) return "@\"" + p + "\"";
		return "@" + p;
	}
	/** 从用户消息文本中提取 @ 文件引用（消息发送后的序列化形式） */
	function extractRefs(content) {
		const out = [];
		for (const b of content) if (b !== null && b !== void 0 && b.type === "text" && typeof b.text === "string") {
			const re = /@"([^"]+)"|@([^\s"@]+)/g;
			let m;
			while ((m = re.exec(b.text)) !== null) {
				const p = (m[1] !== void 0 ? m[1] : m[2]).trim();
				if (p !== "" && !out.includes(p)) out.push(p);
			}
		}
		return out.slice(0, 40);
	}
	/**
	* 后台上传任务队列：逐个落盘（目录任务先遍历），不阻塞输入。
	* 交付物版本走 webServer 二进制路由（/workbuddy-drops），无 base64、无 JSON 体积上限。
	* @returns 成功数量与失败清单（文件名 + 原因）
	*/
	async function runUploadJobs(jobs, batch, maxFileBytes = 268435456) {
		let ok = 0;
		const failed = [];
		for (const j of jobs) {
			const files = j.kind === "dir" ? await walkEntry(j.entry, "") : [{
				rel: j.rel,
				name: j.name,
				size: j.file.size,
				file: j.file
			}];
			for (const f of files) {
				if (f.file.size > maxFileBytes) {
					failed.push(f.name + "（超过大小上限）");
					continue;
				}
				const url = "/workbuddy-drops/save?batch=" + encodeURIComponent(batch) + "&rel=" + encodeURIComponent(f.rel);
				const res = await fetch(url, {
					method: "POST",
					body: f.file
				});
				if (res.ok) {
					const body = await res.json();
					if (body.ok === true) {
						ok += 1;
						continue;
					}
					failed.push(f.name + "（" + (body.error ?? "写入失败") + "）");
				} else failed.push(f.name + "（HTTP " + res.status + "）");
			}
		}
		return {
			ok,
			failed
		};
	}
	/** 缓存根目录（~/.dsh-drops） */
	async function dropsHome() {
		try {
			const body = await (await fetch("/workbuddy-drops/home")).json();
			if (body.ok === true && typeof body.root === "string") return body.root;
			return null;
		} catch {
			return null;
		}
	}
	function walkEntry(entry, rel) {
		return new Promise((resolve2) => {
			if (entry.isFile) {
				entry.file((f) => resolve2([{
					rel: rel === "" ? entry.name : rel + "/" + entry.name,
					name: entry.name,
					size: f.size,
					file: f
				}]), () => resolve2([]));
				return;
			}
			if (entry.isDirectory) {
				const reader = entry.createReader();
				const found = [];
				const readBatch = () => reader.readEntries((ents) => {
					if (ents.length === 0) {
						Promise.all(found.map((e) => walkEntry(e, rel === "" ? entry.name : rel + "/" + entry.name))).then((rs) => resolve2(rs.flat())).catch(() => resolve2([]));
						return;
					}
					found.push(...ents);
					readBatch();
				}, () => resolve2([]));
				readBatch();
				return;
			}
			resolve2([]);
		});
	}
	async function dropsList(query) {
		try {
			return (await (await fetch("/workbuddy-drops/list?query=" + encodeURIComponent(query))).json()).items ?? [];
		} catch {
			return [];
		}
	}
	async function dropsStat(path) {
		try {
			return await (await fetch("/workbuddy-drops/stat?path=" + encodeURIComponent(path))).json();
		} catch {
			return {
				ok: false,
				path
			};
		}
	}
	//#endregion
	//#region src/client/at-source.ts
	/**
	* @ 触发源「workbuddy」：输入 @ 时在菜单中追加「文件缓存」分组 ——
	* ~/.dsh-drops 中拖拽/粘贴/选择落地的文件与目录树，支持搜索。
	* 选中后由输入管线的 onPick → { insert } 在触发词位置铸造原生气泡。
	*
	* 工作区文件/文件夹的 @ 检索由 DSH 官方 ui-reference 源提供（文件与文件夹 +
	* Session 分组），本插件与之共存，无需重复实现。
	*
	* 所有引用在拖入时已完成落地（真实绝对路径），因此 codec 序列化是恒等函数，
	* 发送消息不可能因文件未落地而失败。
	*/
	function createAtSource() {
		return {
			trigger: "@",
			name: "workbuddy",
			order: 5,
			showGroupTitle: true,
			async candidates(_session, req) {
				const items = await dropsList(req && req.query || "");
				const out = [];
				for (const it of items) {
					const isDir = it.type === "directory";
					out.push({
						name: (isDir ? "📁 " : iconFor(it.name) + " ") + it.name + (isDir ? "/" : ""),
						description: it.path,
						section: "文件缓存 · ~/.dsh-drops",
						value: JSON.stringify({
							kind: isDir ? "folder" : "file",
							name: it.name,
							path: it.path
						})
					});
				}
				return out.slice(0, 60);
			},
			onPick(pick) {
				let v = null;
				try {
					v = JSON.parse(pick.candidate.value || "null");
				} catch {
					return;
				}
				if (v === null || typeof v !== "object" || typeof v.path !== "string") return void 0;
				const mention = mentionFor(v.path, v.kind === "folder");
				return { insert: {
					source: "workbuddy",
					ref: mention,
					label: v.name ?? "",
					appearance: v.kind === "folder" ? "folder" : "file",
					clipboardText: mention
				} };
			},
			codec: {
				clipboardText: (ref) => ref,
				serialize: (ref) => Promise.resolve(ref)
			}
		};
	}
	//#endregion
	//#region src/client/components/file-cards.tsx
	/**
	* 对话区文件卡片（挂在 conversation.chat.turnTail 链式槽）：
	* 用户消息发送后，该轮次消息中引用的文件以「类型图标 + 文件名 + 大小/文件夹」卡片
	* 渲染在轮次尾部；点击卡片经 owner 的 openFile 打开文件。
	* selector 只匹配含文件引用的轮次（见 definitions.ts），不抢占其他链条目。
	*/
	function createFileCardsComponent(React) {
		function FileCard(props) {
			const { path, openFile } = props;
			const [meta, setMeta] = React.useState(null);
			React.useEffect(() => {
				let live = true;
				dropsStat(path).then((r) => {
					if (live) setMeta(r);
				}, () => {
					if (live) setMeta({
						ok: false,
						path
					});
				});
				return () => {
					live = false;
				};
			}, [path]);
			const name = String(path).split(/[\\/]/).pop() || path;
			const good = meta !== null && meta !== void 0 && meta.ok === true && meta.exists === true;
			const isDir = good && meta.type === "directory";
			const icon = isDir ? "📁" : iconFor(name);
			const sub = meta === null ? "…" : !good ? "不可用" : isDir ? "文件夹" : formatSize(meta.size);
			return React.createElement("button", {
				type: "button",
				className: "wbd-card",
				title: path,
				onClick: () => {
					if (typeof openFile === "function") try {
						openFile(path);
					} catch {}
				}
			}, React.createElement("span", { className: "wbd-card-icon" }, icon), React.createElement("span", { className: "wbd-card-name" }, name), React.createElement("span", { className: "wbd-card-sub" }, sub));
		}
		return function FileCards(props) {
			const matched = props.matched;
			if (matched === null || matched === void 0 || !Array.isArray(matched.refs) || matched.refs.length === 0) return null;
			return React.createElement("div", { className: "wbd-cards" }, React.createElement("span", { className: "wbd-cards-label" }, "📎 消息引用的文件"), matched.refs.map((path, i) => React.createElement(FileCard, {
				key: String(path) + ":" + i,
				path,
				openFile: props.openFile
			})));
		};
	}
	//#endregion
	//#region src/client/components/overlay.tsx
	/**
	* 全屏拖拽遮罩 + toast（挂在 shell.overlay 列表槽）。
	* 遮罩只在拖拽含非图片文件/文件夹时出现（纯图片拖放交给原生图片轨道）；
	* 层本身点击穿透，遮罩激活时开启 pointer-events 承接 drop。
	*/
	function createOverlayComponent(React, bus) {
		return function WorkbuddyOverlay() {
			const [state, setState] = React.useState(bus.get());
			React.useEffect(() => bus.subscribe(setState), []);
			return React.createElement("div", { className: "wbd-overlay" }, state.active ? React.createElement("div", { className: "wbd-shield" }, React.createElement("div", { className: "wbd-shield-inner" }, React.createElement("div", { className: "wbd-shield-icon" }, "📥"), React.createElement("div", { className: "wbd-shield-title" }, "松开以接收文件"), React.createElement("div", { className: "wbd-shield-sub" }, state.count + " 项 · 将作为引用气泡插入输入框光标处"), React.createElement("div", { className: "wbd-shield-hint" }, "文件（含图片）将缓存至 ~/.dsh-drops 并引用绝对路径"))) : null, state.toast ? React.createElement("div", { className: "wbd-toast" + (state.toast.level === "error" ? " wbd-error" : "") }, state.toast.text) : null);
		};
	}
	//#endregion
	//#region src/client/components/pick-button.tsx
	/**
	* 📎 引用按钮（挂在 conversation.input.left 列表槽）：
	* 统一走 <input type=file>（多选 / webkitdirectory）→ 立即插入气泡 →
	* 后台缓存（所有浏览器行为一致）。
	*/
	function createPickButtonComponent(React, bus, handlers) {
		return function PickButton() {
			const [open, setOpen] = React.useState(false);
			const newBatch = () => "drop-" + Date.now().toString(36);
			const pickFolder = async () => {
				setOpen(false);
				const input = document.createElement("input");
				input.type = "file";
				input.setAttribute("webkitdirectory", "");
				input.onchange = () => {
					const files = [];
					const tops = [];
					for (const f of Array.from(input.files ?? [])) {
						files.push({
							rel: f.webkitRelativePath || f.name,
							name: f.name,
							size: f.size,
							file: f
						});
						const top = (f.webkitRelativePath || "").split("/")[0];
						if (top !== "" && !tops.includes(top)) tops.push(top);
					}
					if (files.length > 0) handlers.acceptTree(files, tops, newBatch());
				};
				input.click();
			};
			const pickFiles = async () => {
				setOpen(false);
				const input = document.createElement("input");
				input.type = "file";
				input.multiple = true;
				input.onchange = () => {
					const files = [];
					for (const f of Array.from(input.files ?? [])) files.push({
						rel: f.name,
						name: f.name,
						size: f.size,
						file: f
					});
					if (files.length > 0) handlers.acceptTree(files, [], newBatch());
				};
				input.click();
			};
			return React.createElement("div", { className: "wbd-pick" }, React.createElement("button", {
				type: "button",
				className: "wbd-pick-btn",
				title: "引用文件/文件夹（也可直接拖拽或粘贴）",
				onClick: () => setOpen(!open)
			}, "📎"), open ? React.createElement("div", { className: "wbd-pick-menu" }, React.createElement("button", {
				type: "button",
				onClick: pickFiles
			}, "选择文件…"), React.createElement("button", {
				type: "button",
				onClick: pickFolder
			}, "选择文件夹…（保留目录树）")) : null);
		};
	}
	//#endregion
	//#region src/client/css.ts
	/** 包内样式（styles.insert 注入，随插件 Run 生命周期清理） */
	const CSS = [
		".wbd-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483000}",
		".wbd-shield{position:fixed;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-color-bg,#0e1116) 72%,transparent);backdrop-filter:blur(2px)}",
		".wbd-shield-inner{min-width:340px;max-width:520px;padding:28px 36px;text-align:center;border:2px dashed var(--dsw-alias-border-l3,#4c9aff);border-radius:14px;background:var(--dsw-color-bg-elevated,#161b24);box-shadow:0 12px 48px rgba(0,0,0,.45)}",
		".wbd-shield-icon{font-size:34px;line-height:1}",
		".wbd-shield-title{margin-top:10px;font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,#f2f4f8)}",
		".wbd-shield-sub{margin-top:6px;font-size:13px;color:var(--dsw-alias-label-secondary,#aab2c0)}",
		".wbd-shield-hint{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}",
		".wbd-toast{position:fixed;right:24px;bottom:132px;max-width:360px;padding:9px 14px;border-radius:10px;background:var(--dsw-color-bg-elevated,#1c222e);border:1px solid var(--dsw-alias-border-l3,#3a4252);color:var(--dsw-alias-label-primary,#f2f4f8);font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:auto}",
		".wbd-toast.wbd-error{border-color:#b3453f}",
		".wbd-cards{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 4px;font-size:13px}",
		".wbd-cards-label{color:var(--dsw-alias-label-tertiary,#6b7280);margin-right:4px}",
		".wbd-card{display:inline-flex;align-items:center;gap:7px;max-width:340px;padding:4px 10px 4px 8px;border:1px solid var(--dsw-alias-border-l2,#2c3342);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary,#f2f4f8);font:inherit;font-size:13px;cursor:pointer;text-align:left}",
		".wbd-card:hover{border-color:var(--dsw-alias-border-l3,#4c9aff)}",
		".wbd-card-icon{flex:none;font-size:15px}",
		".wbd-card-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
		".wbd-card-sub{flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px}",
		".wbd-pick{position:relative;display:inline-flex}",
		".wbd-pick-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#aab2c0);font-size:15px;cursor:pointer}",
		".wbd-pick-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#f2f4f8)}",
		".wbd-pick-menu{position:absolute;left:0;bottom:calc(100% + 8px);display:flex;flex-direction:column;min-width:220px;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#2c3342);background:var(--dsw-color-bg-elevated,#1c222e);box-shadow:0 10px 32px rgba(0,0,0,.4);z-index:10}",
		".wbd-pick-menu button{display:block;width:100%;padding:8px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#f2f4f8);font:inherit;font-size:13px;text-align:left;cursor:pointer}",
		".wbd-pick-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
		"/* ---- 引用气泡换肤：主题色圆角矩形（原子删除由输入机原生保证） ---- */",
		"/* 关键：padding 用等量负 margin 抵消、描边用 box-shadow（不占布局）—— */",
		"/* 气泡外部宽度与 textarea 字符宽度完全一致，backdrop 与光标严格对齐 */",
		"[data-decoration=\"chip\"]{padding:0 8px !important;margin:0 -8px !important;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c9aff) 14%,transparent) !important;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary,#4c9aff) 45%,transparent);color:var(--dsw-alias-brand-primary,#4c9aff) !important;font-weight:500}",
		"[data-decoration=\"chip\"]:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c9aff) 22%,transparent) !important}",
		"[data-decoration=\"chip\"][data-invalid=\"true\"]{color:var(--dsw-alias-state-error-primary,#e56a64) !important;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e56a64) 14%,transparent) !important;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary,#e56a64) 45%,transparent) !important}",
		"[data-decoration=\"chip\"] [class*=\"chipTriggerGlyph\"]{font-size:12px;opacity:.8}"
	].join("\n");
	//#endregion
	//#region src/client/definitions.ts
	const boundaryDef = {
		kind: "workbuddy-turn-boundary",
		match: (event) => event.type === "turn/start" ? {
			id: String(event.data.turn),
			role: "start"
		} : event.type === "turn/end" ? {
			id: String(event.data.turn),
			role: "update"
		} : null,
		start: (_context, match) => {
			if (match.event.type !== "turn/start") throw new Error("workbuddy-turn-boundary start requires turn/start");
			return {
				turn: match.event.data.turn,
				startSeq: match.event.seq
			};
		},
		update: (context) => context.state
	};
	const fileRefsDef = {
		kind: "workbuddy-file-refs",
		match: (event) => {
			if (event.type === "user/message" && event.data?.source?.kind === "user" && event.data.id !== void 0) return {
				id: String(event.data.id),
				role: "start"
			};
			if (event.type === "turn/start" && event.data.turn !== void 0) return {
				id: "turn-" + String(event.data.turn),
				role: "start"
			};
			return null;
		},
		start: (context, match, reader) => {
			if (match.event.type === "turn/start") {
				let refs = [];
				const prev = reader.previous("workbuddy-file-refs");
				const prevBoundary = reader.previous("workbuddy-turn-boundary");
				if (prev !== void 0 && prev.state !== void 0 && Array.isArray(prev.state.refs)) {
					if (prevBoundary === void 0 || prevBoundary.state === void 0 || prev.startSeq > prevBoundary.startSeq) refs = prev.state.refs;
				}
				return {
					turn: match.event.data.turn,
					refs
				};
			}
			const ev = match.event;
			return {
				seq: ev.seq,
				refs: extractRefs(ev.data?.content ?? [])
			};
		},
		update: (context) => context.state,
		buildLocationData: (context, scope) => {
			if (scope !== "turn") return null;
			const s = context.state;
			if (s === void 0 || s.turn === void 0 || !Array.isArray(s.refs) || s.refs.length === 0) return null;
			return {
				kind: "turn",
				turn: s.turn,
				key: "workbuddy-file-refs",
				value: { refs: s.refs }
			};
		}
	};
	/** turnTail chain selector：仅当该轮次存在文件引用时返回 matched，避免抢占其他链条目 */
	function selectTurnFileRefs(owner) {
		const t = owner !== null && owner !== void 0 ? owner.turn : void 0;
		if (t === void 0 || t.data === void 0 || typeof t.data.get !== "function") return null;
		const data = t.data.get("workbuddy-file-refs");
		if (data === void 0 || data === null || !Array.isArray(data.refs) || data.refs.length === 0) return null;
		return { refs: data.refs };
	}
	//#endregion
	//#region src/client/lib/bus.ts
	function createDropBus() {
		let state = {
			active: false,
			count: 0,
			toast: null
		};
		const subs = /* @__PURE__ */ new Set();
		let timer = null;
		const get = () => state;
		const set = (next) => {
			state = next;
			for (const fn of subs) fn(state);
		};
		const subscribe = (fn) => {
			subs.add(fn);
			return () => {
				subs.delete(fn);
			};
		};
		const toast = (text, level = "info") => {
			if (timer !== null) clearTimeout(timer);
			set({
				...state,
				toast: {
					text: String(text),
					level
				}
			});
			timer = setTimeout(() => {
				timer = null;
				set({
					...state,
					toast: null
				});
			}, 4600);
		};
		return {
			get,
			set,
			subscribe,
			toast
		};
	}
	//#endregion
	//#region src/client/lib/drop.ts
	/** 任何文件拖拽都接管；items 不可用（Firefox dragenter/dragover）时按 types 兜底 */
	function interceptable(dt) {
		if (dt === null || dt === void 0) return false;
		if (Array.from(dt.types ?? []).includes("Files")) return true;
		if (dt.items) {
			for (const it of Array.from(dt.items)) if (it.kind === "file") return true;
		}
		return false;
	}
	function countFiles(dt) {
		let n = 0;
		for (const it of Array.from(dt.items)) if (it.kind === "file") n += 1;
		return n;
	}
	/**
	* 关键：DataTransfer 只在事件同步阶段有效 —— getAsFile / webkitGetAsEntry
	* 必须在事件处理器内、任何 await 之前完成调用，否则浏览器清空 DataTransfer
	* 后全部返回 null。本函数专门在同步阶段收集 File / Entry。
	*/
	function syncCollect(dt) {
		const synced = [];
		for (const it of Array.from(dt.items)) {
			if (it.kind !== "file") continue;
			let entry = null;
			try {
				const getter = it.webkitGetAsEntry ?? it.getAsEntry;
				entry = typeof getter === "function" ? getter() : null;
			} catch {
				entry = null;
			}
			let file = null;
			try {
				file = typeof it.getAsFile === "function" ? it.getAsFile() : null;
			} catch {
				file = null;
			}
			if (entry === null && file === null) continue;
			synced.push({
				entry,
				file
			});
		}
		return synced;
	}
	function createDropHandlers(deps) {
		const { bus, insert } = deps;
		const submitRefs = async (refs, jobs, batch) => {
			if (refs.length === 0) {
				bus.toast("无法读取拖入的内容", "error");
				return;
			}
			const inserted = await insert(refs);
			if (inserted > 0) bus.toast("已引用 " + inserted + " 项，文件正在后台缓存");
			else bus.toast("未能插入引用（见上方提示）", "error");
			deps.enqueueUpload(jobs, batch);
		};
		/** 文件选择框路径（已有 TreeFile 列表） */
		const acceptTree = async (files, dirTops, batch) => {
			const root = await deps.ensureRoot();
			if (root === null) {
				bus.toast("无法获取缓存目录，请重试", "error");
				return;
			}
			const refs = [];
			for (const top of dirTops) {
				const dirPath = root + "/" + batch + "/" + top;
				refs.push({
					label: top,
					reference: {
						source: "workbuddy",
						ref: mentionFor(dirPath, true),
						label: top,
						appearance: "folder",
						clipboardText: mentionFor(dirPath, true)
					}
				});
			}
			for (const f of files) {
				const path = root + "/" + batch + "/" + f.rel;
				refs.push({
					label: f.name,
					reference: {
						source: "workbuddy",
						ref: mentionFor(path, false),
						label: f.name,
						appearance: "file",
						clipboardText: mentionFor(path, false)
					}
				});
			}
			await submitRefs(refs, files.map((f) => ({
				kind: "file",
				file: f.file,
				rel: f.rel,
				name: f.name
			})), batch);
		};
		/**
		* 核心：先按预分配路径立即插入气泡，再交给后台缓存。
		* synced 必须在事件内同步收集完毕（见 syncCollect）。
		*/
		const acceptAndInsert = async (synced, batch) => {
			const root = await deps.ensureRoot();
			if (root === null) {
				bus.toast("无法获取缓存目录，请重试", "error");
				return;
			}
			const refs = [];
			const jobs = [];
			for (const s of synced) {
				const { entry, file } = s;
				if (entry !== null && entry !== void 0 && entry.isDirectory) {
					const top = entry.name;
					const dirPath = root + "/" + batch + "/" + top;
					refs.push({
						label: top,
						reference: {
							source: "workbuddy",
							ref: mentionFor(dirPath, true),
							label: top,
							appearance: "folder",
							clipboardText: mentionFor(dirPath, true)
						}
					});
					jobs.push({
						kind: "dir",
						entry
					});
					continue;
				}
				if (file !== null && file !== void 0) {
					const rel = file.name;
					const path = root + "/" + batch + "/" + rel;
					refs.push({
						label: file.name,
						reference: {
							source: "workbuddy",
							ref: mentionFor(path, false),
							label: file.name,
							appearance: "file",
							clipboardText: mentionFor(path, false)
						}
					});
					jobs.push({
						kind: "file",
						file,
						rel,
						name: file.name
					});
					continue;
				}
				if (entry !== null && entry !== void 0 && entry.isFile) {
					const fe = entry;
					const f = await new Promise((resolve2) => fe.file((ff) => resolve2(ff), () => resolve2(null)));
					if (f !== null && f !== void 0) {
						const rel = f.name;
						const path = root + "/" + batch + "/" + rel;
						refs.push({
							label: f.name,
							reference: {
								source: "workbuddy",
								ref: mentionFor(path, false),
								label: f.name,
								appearance: "file",
								clipboardText: mentionFor(path, false)
							}
						});
						jobs.push({
							kind: "file",
							file: f,
							rel,
							name: f.name
						});
					}
				}
			}
			await submitRefs(refs, jobs, batch);
		};
		const installListeners = () => {
			let dragDepth = 0;
			const onDragEnter = (e) => {
				if (!interceptable(e.dataTransfer)) return;
				e.preventDefault();
				e.stopPropagation();
				dragDepth += 1;
				bus.set({
					...bus.get(),
					active: true,
					count: countFiles(e.dataTransfer)
				});
			};
			const onDragOver = (e) => {
				if (!interceptable(e.dataTransfer)) return;
				e.preventDefault();
				e.stopPropagation();
				if (!bus.get().active) {
					dragDepth = 1;
					bus.set({
						...bus.get(),
						active: true,
						count: countFiles(e.dataTransfer)
					});
				}
			};
			const onDragLeave = (e) => {
				if (!interceptable(e.dataTransfer)) return;
				e.preventDefault();
				e.stopPropagation();
				if (dragDepth > 0) dragDepth -= 1;
				if (dragDepth === 0) bus.set({
					...bus.get(),
					active: false,
					count: 0
				});
			};
			const onDrop = (e) => {
				const dt = e.dataTransfer;
				if (dt === null || dt === void 0) return;
				if (!interceptable(dt)) return;
				e.preventDefault();
				e.stopPropagation();
				dragDepth = 0;
				bus.set({
					...bus.get(),
					active: false,
					count: 0
				});
				const synced = syncCollect(dt);
				if (synced.length === 0) return;
				acceptAndInsert(synced, "drop-" + Date.now().toString(36)).catch((err) => {
					console.error("[workbuddy] drop 处理失败:", err);
					bus.toast("拖入处理失败：" + String(err?.message ?? err), "error");
				});
			};
			const onDragEnd = () => {
				dragDepth = 0;
				bus.set({
					...bus.get(),
					active: false,
					count: 0
				});
			};
			const onPaste = (e) => {
				const cd = e.clipboardData;
				if (cd === null || cd === void 0 || !cd.items) return;
				let hasFile = false;
				for (const it of Array.from(cd.items)) if (it.kind === "file") {
					hasFile = true;
					break;
				}
				if (!hasFile) return;
				e.preventDefault();
				e.stopPropagation();
				const synced = syncCollect(cd);
				if (synced.length === 0) return;
				acceptAndInsert(synced, "drop-" + Date.now().toString(36)).catch((err) => {
					console.error("[workbuddy] 粘贴处理失败:", err);
					bus.toast("粘贴处理失败：" + String(err?.message ?? err), "error");
				});
			};
			window.addEventListener("dragenter", onDragEnter, true);
			window.addEventListener("dragover", onDragOver, true);
			window.addEventListener("dragleave", onDragLeave, true);
			window.addEventListener("drop", onDrop, true);
			window.addEventListener("dragend", onDragEnd, true);
			window.addEventListener("paste", onPaste, true);
			return () => {
				window.removeEventListener("dragenter", onDragEnter, true);
				window.removeEventListener("dragover", onDragOver, true);
				window.removeEventListener("dragleave", onDragLeave, true);
				window.removeEventListener("drop", onDrop, true);
				window.removeEventListener("dragend", onDragEnd, true);
				window.removeEventListener("paste", onPaste, true);
			};
		};
		return {
			acceptAndInsert,
			acceptTree,
			installListeners
		};
	}
	//#endregion
	//#region src/client/lib/insert.ts
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	function readCaret(fallbackLen) {
		const el = document.activeElement;
		if (el !== null && el !== void 0 && String(el.tagName).toUpperCase() === "TEXTAREA" && typeof el.selectionStart === "number") return el.selectionStart;
		return fallbackLen;
	}
	function createInsertPipeline(deps) {
		return async function insertItems(items) {
			const sessionId = deps.sessions.list.getSnapshot().current;
			if (sessionId === void 0) {
				deps.toast("请先打开或新建一个会话，再拖入文件", "error");
				return 0;
			}
			let shell = null;
			try {
				shell = deps.conversation.input.shell(sessionId);
			} catch {
				shell = null;
			}
			let inserted = 0;
			let firstCaret = null;
			for (const item of items) if (shell !== null && shell !== void 0) {
				let ok = false;
				for (let attempt = 0; attempt < 8 && !ok; attempt += 1) {
					try {
						const st = shell.state.getSnapshot();
						let caret = st.draft.length;
						if (firstCaret === null) {
							firstCaret = readCaret(st.draft.length);
							caret = firstCaret;
						}
						const pos = Math.min(caret, st.draft.length);
						ok = shell.insertReference(item.reference, {
							start: pos,
							end: pos,
							draftRev: st.draftRev
						});
					} catch {
						ok = false;
					}
					if (!ok) await sleep(90);
				}
				if (ok) {
					inserted += 1;
					continue;
				}
				try {
					const st = shell.state.getSnapshot();
					const pos = Math.min(firstCaret !== null ? firstCaret : st.draft.length, st.draft.length);
					const mention = typeof item.reference.ref === "string" ? item.reference.ref : String(item.label);
					const next = st.draft.slice(0, pos) + mention + " " + st.draft.slice(pos);
					shell.setDraft(next);
					inserted += 1;
					continue;
				} catch (err2) {
					try {
						shell.notify("error", "未能插入引用「" + item.label + "」：" + String(err2?.message ?? err2));
					} catch {}
				}
			} else {
				const text = item.reference.ref;
				const el = document.activeElement;
				if (el !== null && el !== void 0 && String(el.tagName).toUpperCase() === "TEXTAREA") try {
					document.execCommand("insertText", false, text + " ");
					inserted += 1;
				} catch {}
				else deps.toast("输入区不可用，未能插入「" + item.label + "」", "error");
			}
			return inserted;
		};
	}
	//#endregion
	//#region src/client/app.ts
	/**
	* Client 半侧实现（factory 模式）。
	*
	* DSH 客户端模块加载器要求 client 产物是「普通副作用脚本」：加载时调用
	* window.__ModuleLoader__.load({ id, factory })，factory 签名 (require) => module，
	* 返回 { apply, inject, name }。react 通过 factory 的 require('react') 取得
	* （参考 dsh-pet 的 src/client/app.ts 与 index.ts）。
	*
	* 纯逻辑模块（lib/*、at-source、definitions）不依赖 react，可安全地
	* 被 tsdown 内联到 bundle 顶层；组件在 factory 内以注入的 React 构造。
	*/
	function makeFactory() {
		return function workbuddyClientFactory(require) {
			const React = require("react");
			return {
				name: "workbuddy-files",
				inject: [
					"slots",
					"sessions",
					"conversation"
				],
				apply(ctx) {
					try {
						applyClient(ctx, React);
					} catch (err) {
						console.error("[workbuddy-files] client apply 异常:", err);
					}
				}
			};
		};
	}
	function applyClient(ctx, React) {
		console.log("[workbuddy-files] client apply 开始");
		const get = (name) => ctx.get(name);
		const sessions = get("sessions");
		const slots = get("slots");
		const conversation = get("conversation");
		const inputTriggers = get("inputTriggers");
		const conversationEvents = get("conversationEvents");
		const styles = get("styles");
		if (slots === void 0) return;
		const injectCssViaHead = (css) => {
			if (typeof document === "undefined") return;
			const tagId = "dsh-workbuddy-files/styles";
			if (document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workbuddy-files";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		};
		const insertStyles = () => {
			if (styles !== void 0) return styles.insert(CSS);
			injectCssViaHead(CSS);
			return () => {};
		};
		const effect = ctx.effect.bind(ctx);
		effect(insertStyles, "workbuddy: styles");
		console.log("[workbuddy-files] client apply 开始：services slots=" + (slots !== void 0) + " conversation=" + (conversation !== void 0) + " inputTriggers=" + (inputTriggers !== void 0) + " conversationEvents=" + (conversationEvents !== void 0) + " styles=" + (styles !== void 0));
		const bus = createDropBus();
		let rootCache = null;
		dropsHome().then((r) => {
			rootCache = r;
		});
		const ensureRoot = async () => {
			if (rootCache !== null) return rootCache;
			const r = await dropsHome();
			rootCache = r;
			return r;
		};
		const enqueueUpload = (jobs, batch) => {
			runUploadJobs(jobs, batch).then(({ ok, failed }) => {
				if (failed.length > 0) bus.toast("缓存失败 " + failed.length + " 项：" + failed.slice(0, 2).join("；") + (failed.length > 2 ? "…" : ""), "error");
				else if (ok > 0) bus.toast("后台缓存完成：" + ok + " 个文件已就绪");
			}).catch((err) => {
				bus.toast("后台缓存失败：" + String(err?.message ?? err), "error");
			});
		};
		const handlers = createDropHandlers({
			bus,
			insert: createInsertPipeline({
				sessions,
				conversation,
				toast: bus.toast
			}),
			ensureRoot,
			enqueueUpload
		});
		effect(() => {
			const off = handlers.installListeners();
			console.log("[workbuddy-files] 窗口拖拽/粘贴监听已注册");
			return off;
		}, "workbuddy: window listeners");
		if (inputTriggers !== void 0) {
			const source = createAtSource();
			effect(() => inputTriggers.registerSource(source), "workbuddy: @ source");
		}
		if (conversationEvents !== void 0) effect(() => {
			const d1 = conversationEvents.register(boundaryDef);
			const d2 = conversationEvents.register(fileRefsDef);
			return () => {
				if (typeof d1 === "function") d1();
				if (typeof d2 === "function") d2();
			};
		}, "workbuddy: conversation definitions");
		slots.inject("shell.overlay", () => slots.register({
			name: "shell.overlay",
			id: "workbuddy-drop",
			order: 300,
			label: "WorkBuddy 拖拽遮罩"
		}, createOverlayComponent(React, bus)));
		slots.inject("conversation.input.left", () => slots.register({
			name: "conversation.input.left",
			id: "workbuddy-pick",
			order: 0,
			label: "引用文件/文件夹"
		}, createPickButtonComponent(React, bus, handlers)));
		slots.inject("conversation.chat.turnTail", () => slots.register({
			name: "conversation.chat.turnTail",
			select: selectTurnFileRefs
		}, createFileCardsComponent(React)));
		console.log("[workbuddy-files] client 就绪：拖入即插气泡 + 后台缓存 / 统一遮罩 / 文件卡片");
	}
	//#endregion
	//#region src/client/index.ts
	window.__ModuleLoader__.load({
		id: "dsh-workbuddy-files",
		factory: makeFactory()
	});
	//#endregion
})();

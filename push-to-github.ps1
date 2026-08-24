# dsh-workbuddy-files → GitHub 一键发布脚本
# 用法：网络可用时在项目目录双击运行（或 powershell -File push-to-github.ps1）
# 通道：SSH over 443（ssh.github.com），绕过 github.com:443 的间歇性阻断
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repo

Write-Host '== 检查 SSH 通道 ==' -ForegroundColor Cyan
ssh -T git@github.com -o BatchMode=yes -o ConnectTimeout=10 2>&1 | Select-Object -First 3
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
  Write-Host "SSH 通道不可用（exit $LASTEXITCODE）。请确认公钥已添加到 GitHub（Settings → SSH and GPG keys），并确保能连接 ssh.github.com:443" -ForegroundColor Yellow
}

Write-Host '== 切换 remote 到 SSH ==' -ForegroundColor Cyan
git remote set-url origin git@github.com:miaoxintechnology/dsh-workbuddy-files.git
git remote -v

Write-Host '== 推送 ==' -ForegroundColor Cyan
$ok = $false
for ($i = 1; $i -le 5; $i++) {
  git push -u origin main 2>&1
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Write-Host "第 $i 次推送失败，15 秒后重试…" -ForegroundColor Yellow
  Start-Sleep -Seconds 15
}
if ($ok) {
  Write-Host '== 发布成功 ==' -ForegroundColor Green
  Write-Host '仓库地址: https://github.com/miaoxintechnology/dsh-workbuddy-files'
} else {
  Write-Host '推送未成功。若仓库不存在，请先创建：' -ForegroundColor Red
  Write-Host '  https://github.com/new  → 仓库名 dsh-workbuddy-files（Public，不勾选初始化项）'
}

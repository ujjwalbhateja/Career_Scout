$ErrorActionPreference = 'Stop'
$rootPath = $PSScriptRoot
$nodeFolder = Join-Path $rootPath '.local/tools/node-x64/node-v22.14.0-win-x64'
$nodeExe = Join-Path $nodeFolder 'node.exe'
$npmCli = Join-Path $rootPath '.local/tools/npm-runtime/package/bin/npm-cli.js'
$appPath = $rootPath
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  $nodeFolder = Split-Path -Parent $nodeExe
}
$priorPath = $env:PATH
try {
  $env:PATH = "$nodeFolder;$priorPath"
  Push-Location -LiteralPath $appPath
  try {
    if (Test-Path -LiteralPath $npmCli) { & $nodeExe $npmCli run dev }
    else { & npm.cmd run dev }
  } finally { Pop-Location }
} finally { $env:PATH = $priorPath }

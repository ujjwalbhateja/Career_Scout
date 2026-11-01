$ErrorActionPreference = 'Stop'
$rootPath = $PSScriptRoot
$nodeFolder = Join-Path $rootPath '.local/tools/node-x64/node-v22.14.0-win-x64'
$nodeExe = Join-Path $nodeFolder 'node.exe'
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
    & $nodeExe (Join-Path $rootPath 'scripts/start-pipeline.mjs')
  } finally { Pop-Location }
} finally { $env:PATH = $priorPath }

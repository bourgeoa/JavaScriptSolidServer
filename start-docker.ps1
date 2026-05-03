param(
  [int]$ExternalPort = 3000,
  [int]$InternalPort = 3000,
  [string]$RepoUrl = "https://github.com/JavaScriptSolidServer/JavaScriptSolidServer.git",
  [switch]$Https,
  [string]$CertsDir = "./docker/certs",
  [string]$SslKeyPath = "/certs/privkey.pem",
  [string]$SslCertPath = "/certs/fullchain.pem"
)

$env:JSS_EXTERNAL_PORT = "$ExternalPort"
$env:JSS_INTERNAL_PORT = "$InternalPort"
$env:JSS_REPO_URL = $RepoUrl
$env:JSS_CERTS_DIR = $CertsDir
$env:JSS_SSL = if ($Https.IsPresent) { "true" } else { "false" }
$env:JSS_SSL_KEY_PATH = $SslKeyPath
$env:JSS_SSL_CERT_PATH = $SslCertPath

New-Item -ItemType Directory -Force -Path "./docker/jss" | Out-Null

docker compose up -d --build

Write-Host ""
Write-Host "JavaScriptSolidServer is starting..."
if ($Https.IsPresent) {
  Write-Host "URL: https://localhost:$ExternalPort/"
} else {
  Write-Host "URL: http://localhost:$ExternalPort/"
}
Write-Host "Data dir: ./docker/jss"

#
# ================================================================
#  CONTROL PRESUPUESTAL MUNICIPAL
#  Smoke test post-deploy (staging o pre-producción)
#  Archivo: ops/smoke_test_staging.ps1
#  Fecha:   2026-05-25
#
#  OBJETIVO
#  --------
#  Validar, después de un despliegue, que:
#    1. /api/health responde 200 sin token y la BD está OK.
#    2. /api/login emite un JWT firmado válido (3 segmentos).
#    3. Una ruta protegida acepta ese JWT.
#    4. Una ruta protegida rechaza una llamada sin Authorization.
#    5. Headers de seguridad (x-trace-id, x-content-type-options) presentes.
#
#  USO
#  ---
#    .\smoke_test_staging.ps1 `
#        -BaseUrl "https://staging.control-presupuestal.example" `
#        -Usuario "smoketest" `
#        -Password "********"
#
#  El script NO hace POST de datos ni modifica nada. Solo lee.
#  Sale con código 0 si todo OK, 1 si algo falla.
# ================================================================
#
param(
    [Parameter(Mandatory = $true)] [string] $BaseUrl,
    [Parameter(Mandatory = $true)] [string] $Usuario,
    [Parameter(Mandatory = $true)] [string] $Password
)

$ErrorActionPreference = "Stop"
$script:Fallos = 0

function Write-Step([string] $msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Assert([bool] $cond, [string] $desc) {
    if ($cond) {
        Write-Host "    [OK]   $desc" -ForegroundColor Green
    } else {
        Write-Host "    [FAIL] $desc" -ForegroundColor Red
        $script:Fallos++
    }
}

# Quitar slash final del BaseUrl si lo trae
$BaseUrl = $BaseUrl.TrimEnd('/')

# ----------------------------------------------------------------
# 1) Healthcheck SIN token
# ----------------------------------------------------------------
Write-Step "1. GET $BaseUrl/api/health (sin token)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method GET -UseBasicParsing
    $body = $resp.Content | ConvertFrom-Json
    Assert ($resp.StatusCode -eq 200)                "status 200"
    Assert ($body.status -eq "ok")                   "body.status = ok"
    Assert ($body.database.status -eq "ok")          "body.database.status = ok"
    Assert ($resp.Headers["x-trace-id"])             "header x-trace-id presente"
    Assert ($resp.Headers["x-content-type-options"] -eq "nosniff") "header x-content-type-options = nosniff"
} catch {
    Assert $false "healthcheck respondió OK ($($_.Exception.Message))"
}

# ----------------------------------------------------------------
# 2) Login → JWT firmado
# ----------------------------------------------------------------
Write-Step "2. POST $BaseUrl/api/login"
$token = $null
try {
    $loginBody = @{ usuario = $Usuario; password = $Password } | ConvertTo-Json -Compress
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody `
        -UseBasicParsing
    $body = $resp.Content | ConvertFrom-Json
    Assert ($resp.StatusCode -eq 200)                "status 200"
    Assert ($body.token)                             "campo token presente"
    if ($body.token) {
        $segs = $body.token.Split(".")
        Assert ($segs.Length -eq 3)                  "token tiene 3 segmentos (es JWT)"
        Assert (-not ($body.token -match "^token-"))  "token NO usa formato legacy 'token-{id}-{ts}'"
        $token = $body.token
    }
} catch {
    Assert $false "login respondió OK ($($_.Exception.Message))"
}

if (-not $token) {
    Write-Host ""
    Write-Host "Sin token no puedo continuar las pruebas siguientes." -ForegroundColor Yellow
    exit 1
}

# ----------------------------------------------------------------
# 3) Ruta protegida CON token
# ----------------------------------------------------------------
Write-Step "3. GET $BaseUrl/api/catalogos/metas (con JWT)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/catalogos/metas" `
        -Method GET `
        -Headers @{ Authorization = "Bearer $token" } `
        -UseBasicParsing
    Assert ($resp.StatusCode -eq 200)                "status 200"
    Assert ($resp.Headers["x-trace-id"])             "header x-trace-id presente"
} catch {
    # Permitimos 200 o 404 si el usuario de prueba no tiene metas asignadas,
    # PERO 401/403 sí indica problema de auth.
    $sc = $_.Exception.Response.StatusCode.value__
    Assert (($sc -ne 401) -and ($sc -ne 403)) "ruta protegida NO rechaza al JWT válido (status=$sc)"
}

# ----------------------------------------------------------------
# 4) Ruta protegida SIN token → 401
# ----------------------------------------------------------------
Write-Step "4. GET $BaseUrl/api/catalogos/metas (SIN token)"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/catalogos/metas" -Method GET -UseBasicParsing
    Assert $false "ruta protegida sin token NO debería responder 200 (respondió $($resp.StatusCode))"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Assert ($sc -eq 401) "ruta protegida sin token → 401 (recibido $sc)"
}

# ----------------------------------------------------------------
# 5) Logout
# ----------------------------------------------------------------
Write-Step "5. POST $BaseUrl/api/logout"
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/logout" `
        -Method POST `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json" `
        -Body "{}" `
        -UseBasicParsing
    $body = $resp.Content | ConvertFrom-Json
    Assert ($resp.StatusCode -eq 200) "status 200"
    Assert ($body.ok -eq $true)       "body.ok = true"
} catch {
    Assert $false "logout respondió OK ($($_.Exception.Message))"
}

# ----------------------------------------------------------------
# RESUMEN
# ----------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor White
if ($script:Fallos -eq 0) {
    Write-Host "  RESULTADO: SMOKE TEST OK — 0 fallos" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  RESULTADO: SMOKE TEST FALLÓ — $($script:Fallos) errores" -ForegroundColor Red
    exit 1
}

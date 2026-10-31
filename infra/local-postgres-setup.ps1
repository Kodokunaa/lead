# One-time setup for using an already-installed PostgreSQL (16+) instead of Docker.
# Creates the owner role and the dev and test databases from the values in .env.
# psql asks for the PostgreSQL admin ("postgres") password; nothing is stored or printed.
#
#   powershell -ExecutionPolicy Bypass -File infra\local-postgres-setup.ps1
#
# Then point the database URLs in .env at the installed server's port (usually 5432) and run
# `pnpm --filter @lead/api db:migrate`.

param(
  [string]$Psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [int]$Port = 5432,
  [string]$AdminUser = 'postgres'
)

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envFile)) { throw 'No .env found. Copy .env.example to .env first.' }
if (-not (Test-Path $Psql)) { throw "psql not found at $Psql. Pass -Psql with its path." }

$values = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
}
$owner = $values['POSTGRES_USER']
$password = $values['POSTGRES_PASSWORD']
$database = $values['POSTGRES_DB']
if (-not $owner -or -not $password -or -not $database) {
  throw 'POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB must be set in .env.'
}

# CREATEROLE lets migrations create the lead_app runtime role; the owner is not a superuser.
$sql = @'
SELECT format('CREATE ROLE %I LOGIN CREATEROLE PASSWORD %L', :'owner', :'password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('ALTER ROLE %I LOGIN CREATEROLE PASSWORD %L', :'owner', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', name, :'owner')
FROM unnest(ARRAY[:'database', :'database' || '_test']) AS name
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = name) \gexec
'@

# A file, not a pipe: on Windows, piping into psql can stop its password prompt reading keys.
$sqlFile = Join-Path ([System.IO.Path]::GetTempPath()) "lead-setup-$([guid]::NewGuid()).sql"
try {
  Set-Content -Path $sqlFile -Value $sql -Encoding ascii
  & $Psql -h 127.0.0.1 -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 `
    -v "owner=$owner" -v "password=$password" -v "database=$database" -q -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw 'psql failed; nothing else to do until that is fixed.' }
} finally {
  Remove-Item -Path $sqlFile -ErrorAction SilentlyContinue
}
Write-Host "Ready: role '$owner', databases '$database' and '${database}_test' on port $Port."

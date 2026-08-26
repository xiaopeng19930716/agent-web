$ErrorActionPreference = 'SilentlyContinue'
$old = 'C:\Users\kathi\Desktop\agent\agent-web\release'
$stamp = Get-Date -Format 'HHmmss'
$new = 'C:\Users\kathi\Desktop\agent\agent-web\release_old_' + $stamp
try {
    Rename-Item -Path $old -NewName $new -Force
    Write-Host ('RENAMED_OK:' + $new)
} catch {
    Write-Host ('RENAME_FAILED:' + $_.Exception.Message)
}

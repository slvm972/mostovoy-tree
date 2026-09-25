# deploy-guard.ps1
# Использование: .\deploy-guard.ps1
# Проверяет соответствие текущей папки и git remote перед деплоем,
# блокирует деплой при несовпадении.

$expectedPairs = @{
    "mostovoy-tree" = @{
        Path   = "D:\worker"
        Remote = "mostovoy-tree.git"
    }
}

$cwd = (Get-Location).Path
$projectName = "mostovoy-tree"  # единственный существующий Pages-проект

$expected = $expectedPairs[$projectName]

if ($cwd -ne $expected.Path) {
    Write-Host "❌ СТОП: деплой заблокирован." -ForegroundColor Red
    Write-Host "   Текущая папка: $cwd"
    Write-Host "   Ожидалась:     $($expected.Path)"
    Write-Host "   Проект '$projectName' деплоится ТОЛЬКО из $($expected.Path)"
    exit 1
}

$remoteUrl = git remote get-url origin 2>$null
if ($remoteUrl -notmatch [regex]::Escape($expected.Remote)) {
    Write-Host "❌ СТОП: деплой заблокирован." -ForegroundColor Red
    Write-Host "   Git remote: $remoteUrl"
    Write-Host "   Ожидался репозиторий, содержащий: $($expected.Remote)"
    exit 1
}

Write-Host "✅ Проверка пройдена: $cwd ↔ $projectName ($remoteUrl)" -ForegroundColor Green
Write-Host "Запускаю деплой..."
npx wrangler pages deploy . --project-name $projectName
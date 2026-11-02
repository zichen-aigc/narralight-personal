$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$encoded = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($encoded)) {
    throw 'Protected key input is empty.'
}

$protected = [Convert]::FromBase64String($encoded)
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
    [Console]::Out.Write([Convert]::ToBase64String($plain))
}
finally {
    [Array]::Clear($plain, 0, $plain.Length)
}

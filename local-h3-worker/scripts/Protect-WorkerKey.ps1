$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$encoded = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($encoded)) {
    throw 'Private key input is empty.'
}

$plain = [Convert]::FromBase64String($encoded)
try {
    $protected = [Security.Cryptography.ProtectedData]::Protect(
        $plain,
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([Convert]::ToBase64String($protected))
}
finally {
    [Array]::Clear($plain, 0, $plain.Length)
}

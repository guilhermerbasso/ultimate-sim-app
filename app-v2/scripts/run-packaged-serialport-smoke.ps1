$ErrorActionPreference = 'Stop'

$app = Join-Path $PSScriptRoot '..\dist-win\win-unpacked\Ultimate Sim App.exe'
$script = Join-Path $PSScriptRoot 'smoke-packaged-serialport.mjs'
$anchor = Join-Path $PSScriptRoot '..\dist-win\win-unpacked\resources\app.asar\out\main\index.js'

$previous = $env:ELECTRON_RUN_AS_NODE
$env:ELECTRON_RUN_AS_NODE = '1'
try {
    $arguments = '"{0}" "{1}"' -f $script.Replace('"', '\"'), $anchor.Replace('"', '\"')
    $process = Start-Process `
        -FilePath $app `
        -ArgumentList $arguments `
        -NoNewWindow `
        -PassThru `
        -Wait
    exit $process.ExitCode
}
finally {
    if ($null -eq $previous) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
    else {
        $env:ELECTRON_RUN_AS_NODE = $previous
    }
}

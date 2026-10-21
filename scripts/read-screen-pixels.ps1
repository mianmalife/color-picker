param([Parameter(Mandatory = $true)][string]$PointsJson)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopPixelReference {
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
}
'@
$referenceDc = [DesktopPixelReference]::GetDC([IntPtr]::Zero)
if ($referenceDc -eq [IntPtr]::Zero) { throw 'GetDC failed' }
try {
  $referenceResult = foreach ($referencePoint in ($PointsJson | ConvertFrom-Json)) {
    $referenceColor = [DesktopPixelReference]::GetPixel($referenceDc, $referencePoint.x, $referencePoint.y)
    if ($referenceColor -eq [uint32]::MaxValue) { throw 'GetPixel failed' }
    '#{0:X2}{1:X2}{2:X2}' -f ($referenceColor -band 255), (($referenceColor -shr 8) -band 255), (($referenceColor -shr 16) -band 255)
  }
  ConvertTo-Json -InputObject @($referenceResult) -Compress
} finally {
  [void][DesktopPixelReference]::ReleaseDC([IntPtr]::Zero, $referenceDc)
}

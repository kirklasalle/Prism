$ErrorActionPreference='SilentlyContinue'
$r=@{}
function q($cls,$cat,$fmt){
  $items=@()
  try{
    Get-CimInstance -ClassName $cls | ForEach-Object {
      $props=@{}
      $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $props[$_.Name]=[string]$_.Value }
      $items+=@{name=(&$fmt $_);status=if($props['Status']){$props['Status']}else{'OK'};props=$props}
    }
  }catch{ $items+=@{name="Detection failed: $_";status='Error';props=@{}} }
  $r[$cat]=$items
}
q 'Win32_Processor' 'Processors' { param($p) "$($p.Name.Trim()) ($($p.NumberOfCores) cores, $($p.NumberOfLogicalProcessors) threads)" }
q 'Win32_BaseBoard' 'Motherboard' { param($b) "$($b.Manufacturer) $($b.Product)".Trim() }
q 'Win32_PhysicalMemory' 'Memory' { param($m) "$($m.Manufacturer) $([math]::Round([long]$m.Capacity/1GB,2))GB $($m.Speed)MHz".Trim() }
q 'Win32_VideoController' 'Display Adapters' { param($d) if($d.AdapterRAM){("$($d.Name.Trim()) ($([math]::Round($d.AdapterRAM/1GB,2))GB)")}else{$d.Name.Trim()} }
q 'Win32_DiskDrive' 'Disk Drives' { param($d) "$($d.Caption.Trim()) ($([math]::Round([long]$d.Size/1GB,2))GB $($d.InterfaceType))" }
q 'Win32_NetworkAdapter' 'Network Adapters' { param($n) "$($n.Name.Trim()) ($($n.AdapterType))" }
$r['Network Adapters']=$r['Network Adapters'] | Where-Object { $_.props['PhysicalAdapter'] -eq 'True' }
if(-not $r['Network Adapters']){$r['Network Adapters']=@()}
q 'Win32_SoundDevice' 'Sound Devices' { param($s) $s.Name.Trim() }
q 'Win32_USBController' 'USB Controllers' { param($u) $u.Name.Trim() }
q 'Win32_USBHub' 'USB Devices' { param($u) $u.Name.Trim() }
q 'Win32_BIOS' 'BIOS' { param($b) "$($b.Manufacturer) $($b.Name)".Trim() }
q 'Win32_CDROMDrive' 'Optical Drives' { param($c) $c.Name.Trim() }
$r | ConvertTo-Json -Depth 4 -Compress

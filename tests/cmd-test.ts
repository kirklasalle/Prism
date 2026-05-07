import { spawn } from "child_process";

const proc = spawn("cmd.exe", [], { stdio: ["pipe", "pipe", "pipe"] });

proc.stdout.on("data", (d) => console.log("OUT:", d.toString()));
proc.stderr.on("data", (d) => console.log("ERR:", d.toString()));

proc.stdin.write("echo hello\r\n");
proc.stdin.write("echo PRISM_EC=%ERRORLEVEL%\r\n");

setTimeout(() => proc.kill(), 1000);

/** Shared process-local system-pressure guard for sequential video stages. */
export const LTX_VIDEO_MEMORY = String.raw`
def memory_guard():
    critical_since = None
    while True:
        time.sleep(5)
        try:
            result = subprocess.run(["/usr/sbin/sysctl", "-n", "kern.memorystatus_vm_pressure_level"], capture_output=True, text=True, timeout=3)
            if result.returncode != 0:
                continue
            if result.stdout.strip() == "4":
                critical_since = critical_since or time.monotonic()
                if time.monotonic() - critical_since >= 10:
                    emit({"type": "error", "message": "Stopped after sustained critical system memory pressure. Close other model jobs before retrying."})
                    os._exit(77)
            else:
                critical_since = None
        except (OSError, subprocess.TimeoutExpired):
            pass
`;

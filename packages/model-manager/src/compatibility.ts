import type {
  CatalogEntry,
  HardwareInventory,
  ModelCompatibility,
} from "@framebop/core";

const gibibytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(0)} GB`;

/**
 * Judges whether this machine meets a model's stated requirements.
 *
 * Only requirements the publisher states are checked. A requirement that is
 * not stated is reported as unknown, never assumed to pass, so a model is
 * called compatible only when everything that decides it is known. Memory
 * size or a GPU's name alone never makes a model compatible.
 *
 * A recorded test run on the same operating system and architecture is the
 * strongest evidence there is: a run that worked makes the model compatible
 * even when the publisher states nothing, and one that failed makes it
 * incompatible. Without one, that is said too ("not yet tested").
 */
export function evaluateCompatibility(
  entry: CatalogEntry,
  hardware: HardwareInventory,
): ModelCompatibility {
  const checks: ModelCompatibility["checks"] = [];
  const available = hardware.runtimes.filter((runtime) => runtime.available);

  if (entry.hardware.accelerators === null) {
    checks.push({
      label: "Compute back end",
      result: "unknown",
      detail:
        "The publisher does not state which hardware this model supports.",
    });
  } else {
    const usable = available.filter((runtime) =>
      entry.hardware.accelerators?.includes(runtime.id),
    );
    checks.push({
      label: "Compute back end",
      result: usable.length > 0 ? "pass" : "fail",
      detail:
        usable.length > 0
          ? `Supported on ${usable.map((runtime) => runtime.name).join(", ")}, which this machine has.`
          : `Needs ${entry.hardware.accelerators.join(" or ")}, which this machine does not have.`,
    });
  }

  if (entry.platforms !== null) {
    const supported =
      hardware.os !== "unknown" && entry.platforms.includes(hardware.os);
    checks.push({
      label: "Operating system",
      result: supported ? "pass" : "fail",
      detail: supported
        ? `Runs on ${entry.platforms.join(", ")}.`
        : `Runs on ${entry.platforms.join(", ")} only.`,
    });
  }

  if (entry.hardware.minimumMemoryBytes !== null) {
    const enough =
      hardware.memory.totalBytes >= entry.hardware.minimumMemoryBytes;
    checks.push({
      label: "Memory",
      result: enough ? "pass" : "fail",
      detail: `Needs ${gibibytes(entry.hardware.minimumMemoryBytes)}; this machine has ${gibibytes(hardware.memory.totalBytes)}.`,
    });
  }

  const tests = entry.inferenceTests.filter(
    (test) => test.os === hardware.os && test.arch === hardware.arch,
  );
  const failed = tests.find((test) => test.result === "fails");
  const worked = tests.find((test) => test.result === "works");
  const tested: ModelCompatibility["checks"][number] = failed
    ? {
        label: "Tested on this kind of computer",
        result: "fail",
        detail: `Did not work on ${failed.hardware} (${failed.date}): ${failed.detail}`,
      }
    : worked
      ? {
          label: "Tested on this kind of computer",
          result: "pass",
          detail: `Worked on ${worked.hardware} with the ${worked.adapterId} engine (${worked.date}): ${worked.detail}`,
        }
      : {
          label: "Tested on this kind of computer",
          result: "unknown",
          detail: `Compatibility unknown — not yet tested on ${hardware.os} ${hardware.arch}.`,
        };

  const status =
    checks.some((check) => check.result === "fail") || failed
      ? "incompatible"
      : worked
        ? "compatible"
        : checks.some((check) => check.result === "unknown")
          ? "unknown"
          : "compatible";
  return { status, checks: [...checks, tested] };
}

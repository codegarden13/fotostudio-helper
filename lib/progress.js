let scanProgress = {
  active: false,
  current: 0,
  total: 0,
  message: ""
};

export function getScanProgress() {
  return scanProgress;
}

export function setScanProgress(patch) {
  scanProgress = { ...scanProgress, ...patch };
}

export function resetScanProgress() {
  scanProgress = { active: false, current: 0, total: 0, message: "" };
}
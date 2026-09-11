// RAM-dodge handles to the browser globals, kept in one place so the cost is
// paid once. Used by the infiltration helper's DOM overlay.
export const doc = eval('document')
export const win = eval('window')

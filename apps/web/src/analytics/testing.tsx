/** Epoch ms for a New York wall-clock time in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);

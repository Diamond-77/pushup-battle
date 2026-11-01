import { BAR_START, BAR_STEP } from "./config";

// Tug-of-war position, 0 (opponent wins) to 100 (I win).
export function barValue(myReps: number, oppReps: number) {
  return Math.min(100, Math.max(0, BAR_START + BAR_STEP * (myReps - oppReps)));
}

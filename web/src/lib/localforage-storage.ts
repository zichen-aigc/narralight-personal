// Compatibility export: all business persistence now goes to the local platform.
// There is deliberately no browser fallback; falling back would recreate per-browser forks.
export { platformStorage as localForageStorage } from "@/lib/platform-storage";

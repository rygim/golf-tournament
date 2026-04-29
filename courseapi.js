export let API_KEY = '';

const GCAPI_BASE = 'https://api.golfcourseapi.com/v1';
const OPENAPI_BASE = 'https://api.opengolfapi.org/v1';

export function setApiKey(key) { API_KEY = key.trim(); }

/**
 * GolfCourseAPI search — requires API_KEY. One call returns full course data including
 * all tees and hole-by-hole par/yardage.
 */
export async function searchCourses(query) {
  const resp = await fetch(`${GCAPI_BASE}/search?search_query=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': `Key ${API_KEY}` },
  });
  if (!resp.ok) throw new Error(`GolfCourseAPI error ${resp.status}`);
  const data = await resp.json();
  return data.courses || [];
}

/**
 * OpenGolfAPI search — no key required. Returns basic course info only; no tee or yardage data.
 */
export async function searchCoursesOpenGolf(query) {
  const resp = await fetch(`${OPENAPI_BASE}/courses/search?q=${encodeURIComponent(query)}`);
  if (!resp.ok) throw new Error(`OpenGolfAPI error ${resp.status}`);
  const data = await resp.json();
  return data.courses || [];
}

/**
 * Fetch detailed OpenGolfAPI course data (may include scorecard pars).
 */
export async function getCourseDetailOpenGolf(courseId) {
  try {
    const resp = await fetch(`${OPENAPI_BASE}/courses/${courseId}`);
    if (resp.ok) return resp.json();
  } catch (e) { /* network error */ }
  return null;
}

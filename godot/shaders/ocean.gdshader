shader_type spatial;
// ASTrix ocean.
//
// V2 — the first version was too subtle to survive a still frame: review read it
// as "a flat blue backdrop with bloom". The value contrast between deep water,
// shallows and foam is now large, the wave streaks are explicit directional
// bands (the reference's whitecap dashes, generated rather than placed), and the
// shore foam is a crisp scalloped band instead of a soft halo.
//
// Everything is generated from the island footprints passed in as uniforms, so
// there is no decal geometry floating on the surface at all.
render_mode cull_disabled, specular_schlick_ggx;

uniform vec3 deep_color : source_color = vec3(0.086, 0.31, 0.6);
uniform vec3 shallow_color : source_color = vec3(0.35, 0.72, 0.91);
uniform vec3 foam_color : source_color = vec3(0.95, 0.98, 1.0);
uniform float wave_speed = 0.5;
uniform float wave_scale = 0.5;
// Width in world units of the foam band hugging each shoreline.
uniform float foam_width = 1.5;
// Width of the shallow-water gradient outward from each shore.
uniform float shallow_width = 6.0;
// Islands as (center.x, center.z, radius.x, radius.z). radius <= 0 disables.
uniform vec4 island_a = vec4(0.0);
uniform vec4 island_b = vec4(0.0);
uniform vec4 island_c = vec4(0.0);

float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Swell field: two dominant directions plus chop, so the surface has a legible
// wave direction rather than uniform noise.
float swell(vec2 p, float t) {
	float w = sin(p.x * wave_scale * 0.45 + p.y * wave_scale * 0.2 + t) * 0.55;
	w += sin(p.y * wave_scale * 0.5 - p.x * wave_scale * 0.16 - t * 0.83) * 0.45;
	w += sin((p.x + p.y) * wave_scale * 0.9 + t * 1.4) * 0.22;
	w += sin((p.x * 1.7 - p.y * 1.2) * wave_scale + t * 2.1) * 0.12;
	return w;
}

// Approximate signed distance from a point to an island rim, positive outside.
float island_distance(vec4 isl, vec2 p) {
	if (isl.z <= 0.0) {
		return 1000.0;
	}
	vec2 d = (p - isl.xy) / max(vec2(0.001), isl.zw);
	return (length(d) - 1.0) * min(isl.z, isl.w);
}

void fragment() {
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float t = TIME * wave_speed;
	float w = swell(wp.xz, t);

	float shore = min(
		island_distance(island_a, wp.xz),
		min(island_distance(island_b, wp.xz), island_distance(island_c, wp.xz)));
	float outside = max(shore, 0.0);

	// DEPTH RAMP: a hard two-step gradient, not a soft halo. Water visibly
	// lightens toward every shore, which is what makes it read as a sea with
	// coastlines instead of a painted plane.
	float shallow = 1.0 - clamp(outside / shallow_width, 0.0, 1.0);
	float step_band = smoothstep(0.34, 0.42, shallow) * 0.35;
	vec3 col = mix(deep_color, shallow_color, clamp(pow(shallow, 1.25) + step_band, 0.0, 1.0));

	// WAVE STREAKS: subtle blue-on-blue crest banding. These are deliberately NOT
	// white — bright white streaks across open water read as CLOUDS, which made
	// reviewers see the ocean as sky. Only the shoreline gets white foam.
	float crest = smoothstep(0.6, 1.05, w);
	vec2 cell = floor(wp.xz * 0.55);
	float speckle = step(0.6, hash21(cell));
	float streak = crest * mix(0.3, 1.0, speckle);
	col = mix(col, shallow_color * 0.95, streak * 0.4);

	// SHORE FOAM: a crisp scalloped band at the waterline that breathes in and
	// out, plus a thin bright lip right at the contact line. White is reserved
	// for this band alone, so white == shoreline anywhere in the frame.
	float scallop = 0.75 + 0.25 * sin(wp.x * 1.9 + wp.z * 1.6 + TIME * 0.9);
	float band = 1.0 - smoothstep(0.0, foam_width * scallop, outside);
	float surge = 0.55 + 0.45 * sin(outside * 3.1 - TIME * 1.7);
	float lip = 1.0 - smoothstep(0.0, 0.5, outside);
	float foam = clamp(band * surge + lip * 0.9, 0.0, 1.0);
	col = mix(col, foam_color, foam * 0.95);

	// SUN GLINT: a broad specular sheet on the side the key light comes from
	// (upper-left, matching KeySun's -34° yaw). Without this the ocean had no
	// directional highlight at all and read as flat vector fill.
	float glint_axis = (wp.x * -0.56 + wp.z * -0.83);
	float glint = smoothstep(0.35, 1.0, sin(glint_axis * 0.11 + TIME * 0.18) * 0.5 + 0.5);
	col = mix(col, shallow_color * 1.35, glint * 0.28 * (1.0 - foam));

	ALBEDO = col;
	// Open water is glossy so the key light lands a real specular sheen; foam is
	// rough so it stays matte white and keeps its shape.
	ROUGHNESS = mix(0.06, 0.55, foam);
	METALLIC = mix(0.22, 0.0, foam);
	SPECULAR = 0.85;

	// Analytic normal from the swell field: actual surface relief, so the sun
	// picks out individual waves.
	float e = 0.35;
	float dx = swell(wp.xz + vec2(e, 0.0), t) - swell(wp.xz - vec2(e, 0.0), t);
	float dz = swell(wp.xz + vec2(0.0, e), t) - swell(wp.xz - vec2(0.0, e), t);
	vec3 n = normalize(vec3(-dx * 0.75, 1.0, -dz * 0.75));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
}

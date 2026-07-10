//! Color tool: parse, convert and transform colors, plus palette generation
//! and a small library of curated palettes.
//!
//! Designed to be driven both by the UI color picker and by an agent: give it a
//! color in *any* common format (`#f00`, `#ff0000`, `rgb(255,0,0)`,
//! `hsl(0,100%,50%)`, or a CSS name) and an operation, and it returns the
//! result in every format at once.

use serde::Serialize;

use crate::{Error, Result};

/// An sRGB color (0–255 per channel) plus an optional alpha (0–1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: f64,
}

/// HSL representation: hue 0–360, saturation/lightness 0–1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Hsl {
    pub h: f64,
    pub s: f64,
    pub l: f64,
}

/// Everything about a color, ready to hand back to the UI or an agent.
#[derive(Debug, Clone, Serialize)]
pub struct ColorInfo {
    pub hex: String,
    pub rgb: String,
    pub hsl: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: f64,
    pub hue: f64,
    pub saturation: f64,
    pub lightness: f64,
    /// WCAG relative luminance (0–1).
    pub luminance: f64,
    /// Best-contrast text color over this background (`#000000` or `#ffffff`).
    pub on_color: String,
}

/// A named, ordered list of colors (hex strings).
#[derive(Debug, Clone, Serialize)]
pub struct Palette {
    pub name: String,
    pub source: String,
    pub colors: Vec<String>,
}

impl Rgb {
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Rgb { r, g, b, a: 1.0 }
    }

    pub fn to_hex(self) -> String {
        if (self.a - 1.0).abs() < f64::EPSILON {
            format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
        } else {
            let a = (self.a.clamp(0.0, 1.0) * 255.0).round() as u8;
            format!("#{:02x}{:02x}{:02x}{:02x}", self.r, self.g, self.b, a)
        }
    }

    pub fn to_rgb_string(self) -> String {
        if (self.a - 1.0).abs() < f64::EPSILON {
            format!("rgb({}, {}, {})", self.r, self.g, self.b)
        } else {
            format!(
                "rgba({}, {}, {}, {})",
                self.r,
                self.g,
                self.b,
                round2(self.a)
            )
        }
    }

    pub fn to_hsl(self) -> Hsl {
        rgb_to_hsl(self)
    }

    /// WCAG relative luminance.
    pub fn luminance(self) -> f64 {
        fn lin(c: u8) -> f64 {
            let c = c as f64 / 255.0;
            if c <= 0.03928 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * lin(self.r) + 0.7152 * lin(self.g) + 0.0722 * lin(self.b)
    }

    pub fn info(self) -> ColorInfo {
        let hsl = self.to_hsl();
        let on = if contrast_ratio(self, Rgb::new(0, 0, 0))
            >= contrast_ratio(self, Rgb::new(255, 255, 255))
        {
            "#000000"
        } else {
            "#ffffff"
        };
        ColorInfo {
            hex: self.to_hex(),
            rgb: self.to_rgb_string(),
            hsl: hsl_string(hsl, self.a),
            r: self.r,
            g: self.g,
            b: self.b,
            a: round2(self.a),
            hue: round2(hsl.h),
            saturation: round2(hsl.s),
            lightness: round2(hsl.l),
            luminance: round4(self.luminance()),
            on_color: on.to_string(),
        }
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
fn round4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

fn hsl_string(h: Hsl, a: f64) -> String {
    if (a - 1.0).abs() < f64::EPSILON {
        format!(
            "hsl({}, {}%, {}%)",
            h.h.round() as i64,
            (h.s * 100.0).round() as i64,
            (h.l * 100.0).round() as i64
        )
    } else {
        format!(
            "hsla({}, {}%, {}%, {})",
            h.h.round() as i64,
            (h.s * 100.0).round() as i64,
            (h.l * 100.0).round() as i64,
            round2(a)
        )
    }
}

/// Convert RGB → HSL (hue 0–360, sat/lum 0–1).
pub fn rgb_to_hsl(c: Rgb) -> Hsl {
    let r = c.r as f64 / 255.0;
    let g = c.g as f64 / 255.0;
    let b = c.b as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    let d = max - min;
    if d.abs() < 1e-9 {
        return Hsl { h: 0.0, s: 0.0, l };
    }
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let mut h = if (max - r).abs() < 1e-9 {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < 1e-9 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    h *= 60.0;
    Hsl { h, s, l }
}

/// Convert HSL → RGB.
pub fn hsl_to_rgb(c: Hsl) -> Rgb {
    let h = c.h.rem_euclid(360.0) / 360.0;
    let s = c.s.clamp(0.0, 1.0);
    let l = c.l.clamp(0.0, 1.0);
    if s.abs() < 1e-9 {
        let v = (l * 255.0).round() as u8;
        return Rgb::new(v, v, v);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let hue = |t: f64| -> f64 {
        let mut t = t;
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 1.0 / 2.0 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    Rgb::new(
        (hue(h + 1.0 / 3.0) * 255.0).round() as u8,
        (hue(h) * 255.0).round() as u8,
        (hue(h - 1.0 / 3.0) * 255.0).round() as u8,
    )
}

/// WCAG contrast ratio between two colors (1.0–21.0).
pub fn contrast_ratio(a: Rgb, b: Rgb) -> f64 {
    let (l1, l2) = (a.luminance(), b.luminance());
    let (hi, lo) = if l1 >= l2 { (l1, l2) } else { (l2, l1) };
    (hi + 0.05) / (lo + 0.05)
}

/// Parse a color from `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`,
/// `hsl()/hsla()`, or a CSS color name.
pub fn parse_color(input: &str) -> Result<Rgb> {
    let s = input.trim();
    if s.is_empty() {
        return Err(Error::InvalidInput("empty color".into()));
    }
    let lower = s.to_ascii_lowercase();

    if let Some(hex) = lower.strip_prefix('#') {
        return parse_hex(hex);
    }
    if let Some(named) = css_named(&lower) {
        return Ok(named);
    }
    if let Some(rest) = lower.strip_prefix("rgb") {
        return parse_rgb_func(rest);
    }
    if let Some(rest) = lower.strip_prefix("hsl") {
        return parse_hsl_func(rest);
    }
    // Bare hex without '#'.
    if lower.chars().all(|c| c.is_ascii_hexdigit()) {
        return parse_hex(&lower);
    }
    Err(Error::InvalidInput(format!("unrecognized color: {input}")))
}

fn parse_hex(hex: &str) -> Result<Rgb> {
    let h = hex.trim();
    let expand = |c: char| -> u8 {
        let s = format!("{c}{c}");
        u8::from_str_radix(&s, 16).unwrap_or(0)
    };
    let bytes: Vec<char> = h.chars().collect();
    match bytes.len() {
        3 => Ok(Rgb::new(
            expand(bytes[0]),
            expand(bytes[1]),
            expand(bytes[2]),
        )),
        4 => Ok(Rgb {
            r: expand(bytes[0]),
            g: expand(bytes[1]),
            b: expand(bytes[2]),
            a: expand(bytes[3]) as f64 / 255.0,
        }),
        6 => Ok(Rgb::new(hx(&h[0..2])?, hx(&h[2..4])?, hx(&h[4..6])?)),
        8 => Ok(Rgb {
            r: hx(&h[0..2])?,
            g: hx(&h[2..4])?,
            b: hx(&h[4..6])?,
            a: hx(&h[6..8])? as f64 / 255.0,
        }),
        _ => Err(Error::InvalidInput(format!("bad hex color: #{hex}"))),
    }
}

fn hx(s: &str) -> Result<u8> {
    u8::from_str_radix(s, 16).map_err(|_| Error::InvalidInput(format!("bad hex byte: {s}")))
}

fn inside_parens(s: &str) -> &str {
    s.trim()
        .trim_start_matches('(')
        .trim_end_matches(')')
        .trim()
}

fn parse_rgb_func(rest: &str) -> Result<Rgb> {
    let body = inside_parens(rest.trim_start_matches('a'));
    let parts: Vec<&str> = body
        .split([',', '/', ' '])
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() < 3 {
        return Err(Error::InvalidInput(format!("bad rgb(): {rest}")));
    }
    let chan = |p: &str| -> Result<u8> {
        let p = p.trim();
        if let Some(pct) = p.strip_suffix('%') {
            let v: f64 = pct
                .trim()
                .parse()
                .map_err(|_| Error::InvalidInput("bad rgb channel".into()))?;
            Ok((v / 100.0 * 255.0).round().clamp(0.0, 255.0) as u8)
        } else {
            let v: f64 = p
                .parse()
                .map_err(|_| Error::InvalidInput("bad rgb channel".into()))?;
            Ok(v.round().clamp(0.0, 255.0) as u8)
        }
    };
    let a = if parts.len() >= 4 {
        parts[3]
            .trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .unwrap_or(1.0)
    } else {
        1.0
    };
    let a = if parts.len() >= 4 && parts[3].contains('%') {
        a / 100.0
    } else {
        a
    };
    Ok(Rgb {
        r: chan(parts[0])?,
        g: chan(parts[1])?,
        b: chan(parts[2])?,
        a: a.clamp(0.0, 1.0),
    })
}

fn parse_hsl_func(rest: &str) -> Result<Rgb> {
    let body = inside_parens(rest.trim_start_matches('a'));
    let parts: Vec<&str> = body
        .split([',', '/', ' '])
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() < 3 {
        return Err(Error::InvalidInput(format!("bad hsl(): {rest}")));
    }
    let h: f64 = parts[0]
        .trim()
        .trim_end_matches("deg")
        .parse()
        .map_err(|_| Error::InvalidInput("bad hue".into()))?;
    let pct = |p: &str| -> Result<f64> {
        p.trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .map(|v| v / 100.0)
            .map_err(|_| Error::InvalidInput("bad hsl percent".into()))
    };
    let mut rgb = hsl_to_rgb(Hsl {
        h,
        s: pct(parts[1])?,
        l: pct(parts[2])?,
    });
    if parts.len() >= 4 {
        rgb.a = parts[3]
            .trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .unwrap_or(1.0)
            .clamp(0.0, 1.0);
    }
    Ok(rgb)
}

// -- transforms ---------------------------------------------------------------

fn with_l(c: Rgb, f: impl Fn(f64) -> f64) -> Rgb {
    let mut hsl = c.to_hsl();
    hsl.l = f(hsl.l).clamp(0.0, 1.0);
    let mut out = hsl_to_rgb(hsl);
    out.a = c.a;
    out
}

fn with_s(c: Rgb, f: impl Fn(f64) -> f64) -> Rgb {
    let mut hsl = c.to_hsl();
    hsl.s = f(hsl.s).clamp(0.0, 1.0);
    let mut out = hsl_to_rgb(hsl);
    out.a = c.a;
    out
}

pub fn lighten(c: Rgb, amount: f64) -> Rgb {
    with_l(c, |l| l + amount)
}
pub fn darken(c: Rgb, amount: f64) -> Rgb {
    with_l(c, |l| l - amount)
}
pub fn saturate(c: Rgb, amount: f64) -> Rgb {
    with_s(c, |s| s + amount)
}
pub fn desaturate(c: Rgb, amount: f64) -> Rgb {
    with_s(c, |s| s - amount)
}
pub fn grayscale(c: Rgb) -> Rgb {
    with_s(c, |_| 0.0)
}

/// Rotate the hue by `deg` degrees.
pub fn rotate_hue(c: Rgb, deg: f64) -> Rgb {
    let mut hsl = c.to_hsl();
    hsl.h = (hsl.h + deg).rem_euclid(360.0);
    let mut out = hsl_to_rgb(hsl);
    out.a = c.a;
    out
}

pub fn complement(c: Rgb) -> Rgb {
    rotate_hue(c, 180.0)
}

/// Mix two colors; `t` is the weight of `b` (0 → all `a`, 1 → all `b`).
pub fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    let lerp = |x: u8, y: u8| (x as f64 + (y as f64 - x as f64) * t).round() as u8;
    Rgb {
        r: lerp(a.r, b.r),
        g: lerp(a.g, b.g),
        b: lerp(a.b, b.b),
        a: a.a + (b.a - a.a) * t,
    }
}

/// Apply a named operation an agent can request.
/// `op`: lighten | darken | saturate | desaturate | grayscale | complement |
/// rotate | invert. `amount` is 0–1 for l/d/s, degrees for `rotate`.
pub fn apply_op(c: Rgb, op: &str, amount: f64) -> Result<Rgb> {
    Ok(match op.to_ascii_lowercase().as_str() {
        "lighten" => lighten(c, amount),
        "darken" => darken(c, amount),
        "saturate" => saturate(c, amount),
        "desaturate" => desaturate(c, amount),
        "grayscale" | "greyscale" => grayscale(c),
        "complement" | "complementary" => complement(c),
        "rotate" | "spin" => rotate_hue(c, amount),
        "invert" => Rgb {
            r: 255 - c.r,
            g: 255 - c.g,
            b: 255 - c.b,
            a: c.a,
        },
        other => return Err(Error::InvalidInput(format!("unknown color op: {other}"))),
    })
}

/// Agent-facing entry point: parse `color`, apply `op`, return full info.
pub fn transform(color: &str, op: &str, amount: f64) -> Result<ColorInfo> {
    Ok(apply_op(parse_color(color)?, op, amount)?.info())
}

// -- palette generation -------------------------------------------------------

/// Generate a palette around `c`. `scheme`:
/// complementary | analogous | triadic | tetradic | monochromatic | shades |
/// tints. `count` applies to monochromatic/shades/tints (clamped 2–12).
pub fn generate_palette(c: Rgb, scheme: &str, count: usize) -> Result<Vec<Rgb>> {
    let n = count.clamp(2, 12);
    let out = match scheme.to_ascii_lowercase().as_str() {
        "complementary" => vec![c, complement(c)],
        "analogous" => vec![rotate_hue(c, -30.0), c, rotate_hue(c, 30.0)],
        "triadic" => vec![c, rotate_hue(c, 120.0), rotate_hue(c, 240.0)],
        "tetradic" | "square" => vec![
            c,
            rotate_hue(c, 90.0),
            rotate_hue(c, 180.0),
            rotate_hue(c, 270.0),
        ],
        "monochromatic" => {
            let hsl = c.to_hsl();
            (0..n)
                .map(|i| {
                    let l = 0.1 + 0.8 * (i as f64 / (n - 1) as f64);
                    let mut r = hsl_to_rgb(Hsl { l, ..hsl });
                    r.a = c.a;
                    r
                })
                .collect()
        }
        "shades" => (0..n).map(|i| darken(c, 0.07 * i as f64)).collect(),
        "tints" => (0..n).map(|i| lighten(c, 0.07 * i as f64)).collect(),
        other => return Err(Error::InvalidInput(format!("unknown scheme: {other}"))),
    };
    Ok(out)
}

/// Like [`generate_palette`] but returns hex strings (handy for the UI/agent).
pub fn palette_hex(color: &str, scheme: &str, count: usize) -> Result<Vec<String>> {
    Ok(generate_palette(parse_color(color)?, scheme, count)?
        .into_iter()
        .map(|c| c.to_hex())
        .collect())
}

// -- curated palettes ---------------------------------------------------------

/// A small library of well-known palettes ("цветные палитры из разных сайтов").
pub fn named_palettes() -> Vec<Palette> {
    let p = |name: &str, source: &str, colors: &[&str]| Palette {
        name: name.to_string(),
        source: source.to_string(),
        colors: colors.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        p(
            "Tailwind Slate",
            "tailwindcss.com",
            &[
                "#f8fafc", "#e2e8f0", "#94a3b8", "#475569", "#1e293b", "#0f172a",
            ],
        ),
        p(
            "Tailwind Sky",
            "tailwindcss.com",
            &[
                "#f0f9ff", "#bae6fd", "#38bdf8", "#0284c7", "#075985", "#0c4a6e",
            ],
        ),
        p(
            "Material Indigo",
            "material.io",
            &[
                "#e8eaf6", "#9fa8da", "#5c6bc0", "#3f51b5", "#283593", "#1a237e",
            ],
        ),
        p(
            "Material Teal",
            "material.io",
            &[
                "#e0f2f1", "#80cbc4", "#26a69a", "#009688", "#00695c", "#004d40",
            ],
        ),
        p(
            "Solarized",
            "ethanschoonover.com/solarized",
            &[
                "#002b36", "#073642", "#268bd2", "#2aa198", "#859900", "#b58900", "#cb4b16",
                "#dc322f", "#d33682", "#6c71c4", "#eee8d5", "#fdf6e3",
            ],
        ),
        p(
            "Dracula",
            "draculatheme.com",
            &[
                "#282a36", "#44475a", "#f8f8f2", "#6272a4", "#8be9fd", "#50fa7b", "#ffb86c",
                "#ff79c6", "#bd93f9", "#ff5555", "#f1fa8c",
            ],
        ),
        p(
            "Nord",
            "nordtheme.com",
            &[
                "#2e3440", "#3b4252", "#434c5e", "#4c566a", "#d8dee9", "#88c0d0", "#81a1c1",
                "#5e81ac", "#bf616a", "#a3be8c", "#ebcb8b", "#b48ead",
            ],
        ),
        p(
            "Catppuccin Mocha",
            "catppuccin.com",
            &[
                "#1e1e2e", "#cdd6f4", "#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5",
                "#89b4fa", "#cba6f7",
            ],
        ),
    ]
}

#[allow(clippy::match_same_arms)]
fn css_named(name: &str) -> Option<Rgb> {
    let c = |r, g, b| Some(Rgb::new(r, g, b));
    match name {
        "black" => c(0, 0, 0),
        "white" => c(255, 255, 255),
        "red" => c(255, 0, 0),
        "green" => c(0, 128, 0),
        "lime" => c(0, 255, 0),
        "blue" => c(0, 0, 255),
        "yellow" => c(255, 255, 0),
        "cyan" | "aqua" => c(0, 255, 255),
        "magenta" | "fuchsia" => c(255, 0, 255),
        "gray" | "grey" => c(128, 128, 128),
        "silver" => c(192, 192, 192),
        "maroon" => c(128, 0, 0),
        "olive" => c(128, 128, 0),
        "navy" => c(0, 0, 128),
        "teal" => c(0, 128, 128),
        "purple" => c(128, 0, 128),
        "orange" => c(255, 165, 0),
        "pink" => c(255, 192, 203),
        "brown" => c(165, 42, 42),
        "gold" => c(255, 215, 0),
        "indigo" => c(75, 0, 130),
        "violet" => c(238, 130, 238),
        "coral" => c(255, 127, 80),
        "salmon" => c(250, 128, 114),
        "tomato" => c(255, 99, 71),
        "crimson" => c(220, 20, 60),
        "transparent" => Some(Rgb {
            r: 0,
            g: 0,
            b: 0,
            a: 0.0,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_all_formats() {
        let red = Rgb::new(255, 0, 0);
        assert_eq!(parse_color("#f00").unwrap(), red);
        assert_eq!(parse_color("#ff0000").unwrap(), red);
        assert_eq!(parse_color("FF0000").unwrap(), red);
        assert_eq!(parse_color("rgb(255, 0, 0)").unwrap(), red);
        assert_eq!(parse_color("rgb(255 0 0)").unwrap(), red);
        assert_eq!(parse_color("red").unwrap(), red);
        assert_eq!(parse_color("  Red ").unwrap(), red);
        let h = parse_color("hsl(0, 100%, 50%)").unwrap();
        assert_eq!(h, red);
        assert!(parse_color("nope!!!").is_err());
        assert!(parse_color("#12345").is_err());
    }

    #[test]
    fn hex_roundtrip_and_alpha() {
        let c = parse_color("#3498db").unwrap();
        assert_eq!(c.to_hex(), "#3498db");
        let a = parse_color("#ff000080").unwrap();
        assert!((a.a - 0.5019).abs() < 0.01);
        assert_eq!(a.r, 255);
        assert_eq!(
            parse_color("rgba(0,0,0,0.5)").unwrap().to_hex(),
            "#00000080"
        );
    }

    #[test]
    fn hsl_conversions_roundtrip() {
        for hex in [
            "#ff0000", "#00ff00", "#0000ff", "#3498db", "#808080", "#123456",
        ] {
            let c = parse_color(hex).unwrap();
            let back = hsl_to_rgb(rgb_to_hsl(c));
            // Allow ±1 per channel for rounding.
            assert!((c.r as i32 - back.r as i32).abs() <= 1, "{hex} r");
            assert!((c.g as i32 - back.g as i32).abs() <= 1, "{hex} g");
            assert!((c.b as i32 - back.b as i32).abs() <= 1, "{hex} b");
        }
        let hsl = rgb_to_hsl(Rgb::new(255, 0, 0));
        assert_eq!(hsl.h.round() as i64, 0);
        assert!((hsl.s - 1.0).abs() < 1e-6);
        assert!((hsl.l - 0.5).abs() < 1e-6);
    }

    #[test]
    fn lighten_darken_and_complement() {
        let c = parse_color("#3498db").unwrap();
        assert!(lighten(c, 0.2).luminance() > c.luminance());
        assert!(darken(c, 0.2).luminance() < c.luminance());
        // Complement of red is cyan-ish (hue ~180).
        let comp = complement(Rgb::new(255, 0, 0));
        assert_eq!(comp.to_hex(), "#00ffff");
    }

    #[test]
    fn mixing() {
        let mixed = mix(Rgb::new(0, 0, 0), Rgb::new(255, 255, 255), 0.5);
        assert_eq!(mixed, Rgb::new(128, 128, 128));
    }

    #[test]
    fn contrast_matches_wcag_known_values() {
        // black on white is the max 21:1.
        let r = contrast_ratio(Rgb::new(0, 0, 0), Rgb::new(255, 255, 255));
        assert!((r - 21.0).abs() < 0.01);
        // identical colors → 1:1.
        let r = contrast_ratio(Rgb::new(10, 20, 30), Rgb::new(10, 20, 30));
        assert!((r - 1.0).abs() < 1e-9);
    }

    #[test]
    fn info_picks_readable_text_color() {
        assert_eq!(parse_color("#ffffff").unwrap().info().on_color, "#000000");
        assert_eq!(parse_color("#000000").unwrap().info().on_color, "#ffffff");
        let i = parse_color("#3498db").unwrap().info();
        assert_eq!(i.hex, "#3498db");
        assert!(i.rgb.starts_with("rgb("));
        assert!(i.hsl.starts_with("hsl("));
    }

    #[test]
    fn agent_transform_entry() {
        let out = transform("#ff0000", "lighten", 0.2).unwrap();
        // lighter red is pinkish, luminance up.
        assert!(out.luminance > parse_color("#ff0000").unwrap().luminance());
        let inv = transform("rgb(0,0,0)", "invert", 0.0).unwrap();
        assert_eq!(inv.hex, "#ffffff");
        assert!(transform("#fff", "bogus", 0.0).is_err());
    }

    #[test]
    fn palettes_generate_and_curated_exist() {
        let tri = palette_hex("#ff0000", "triadic", 3).unwrap();
        assert_eq!(tri.len(), 3);
        assert_eq!(tri[0], "#ff0000");
        let mono = palette_hex("#3498db", "monochromatic", 5).unwrap();
        assert_eq!(mono.len(), 5);
        assert!(palette_hex("#3498db", "nope", 5).is_err());

        let named = named_palettes();
        assert!(named.len() >= 6);
        assert!(named.iter().any(|p| p.name == "Dracula"));
        // Every curated color parses.
        for pal in &named {
            for hexc in &pal.colors {
                assert!(parse_color(hexc).is_ok(), "{} bad: {hexc}", pal.name);
            }
        }
    }
}

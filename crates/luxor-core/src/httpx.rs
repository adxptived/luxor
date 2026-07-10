//! Outbound HTTP helpers: the REST scratch pad runner, package registry
//! search (npm / crates.io / PyPI) and OSV vulnerability lookups.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

const MAX_BODY_BYTES: usize = 2_000_000;

fn client(timeout_ms: u64) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.clamp(1_000, 120_000)))
        .user_agent("luxor-app")
        .build()
        .map_err(Error::from)
}

// ---------------------------------------------------------------------------
// REST scratch pad
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Opt-in SSRF guard: when true, reject requests whose host is a
    /// loopback/private/link-local address (or `localhost`). Defaults to false
    /// so the scratch pad can still hit local dev servers unless asked not to.
    #[serde(default)]
    pub block_private: bool,
}

/// Is `host` a loopback/private/link-local address literal (or `localhost`)?
/// Hostnames that aren't IP literals return false (no DNS resolution here).
pub fn is_private_host(host: &str) -> bool {
    use std::net::IpAddr;
    let h = host.trim().trim_start_matches('[').trim_end_matches(']');
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        Ok(IpAddr::V6(v6)) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            let seg = v6.segments();
            // fc00::/7 (unique local) or fe80::/10 (link local).
            (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80
        }
        Err(_) => false,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    /// True when the body was cut off at the size cap.
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// Run one scratch-pad request. Only http/https URLs are allowed.
pub async fn http_request(req: HttpRequest) -> Result<HttpResponse> {
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err(Error::InvalidInput(
            "only http(s) URLs are supported".into(),
        ));
    }
    if req.block_private {
        if let Ok(parsed) = reqwest::Url::parse(&req.url) {
            if let Some(host) = parsed.host_str() {
                if is_private_host(host) {
                    return Err(Error::InvalidInput(format!(
                        "blocked request to private/loopback host: {host}"
                    )));
                }
            }
        }
    }
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|_| Error::InvalidInput(format!("invalid method {}", req.method)))?;
    let client = client(req.timeout_ms.unwrap_or(30_000))?;
    let mut builder = client.request(method.clone(), &req.url);
    for (name, value) in &req.headers {
        if !name.trim().is_empty() {
            builder = builder.header(name.trim(), value.trim());
        }
    }
    if !req.body.is_empty() && method != reqwest::Method::GET && method != reqwest::Method::HEAD {
        builder = builder.body(req.body.clone());
    }
    let started = Instant::now();
    let mut resp = builder.send().await?;
    let status = resp.status();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect();
    // Stream the body and stop at the cap instead of buffering the whole
    // response first: a huge/streaming endpoint can't blow up memory now.
    let mut buf: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await? {
        let remaining = MAX_BODY_BYTES.saturating_sub(buf.len());
        if chunk.len() > remaining {
            buf.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&buf).to_string();
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Package registries
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct RegistryPackage {
    pub name: String,
    pub version: String,
    pub description: String,
    pub url: String,
    /// Weekly/total downloads where the registry reports them (0 otherwise).
    pub downloads: u64,
}

/// Search a package registry. `kind`: `npm` | `cargo` | `pip`.
pub async fn registry_search(
    kind: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<RegistryPackage>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 50);
    let client = client(15_000)?;
    let get = |url: String| {
        let client = client.clone();
        async move {
            client
                .get(&url)
                .send()
                .await?
                .json::<serde_json::Value>()
                .await
                .map_err(Error::from)
        }
    };
    match kind {
        "npm" => {
            let json = get(format!(
                "https://registry.npmjs.org/-/v1/search?text={}&size={limit}",
                urlencode(query)
            ))
            .await?;
            let empty = Vec::new();
            Ok(json["objects"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .filter_map(|o| {
                    let p = &o["package"];
                    Some(RegistryPackage {
                        name: p["name"].as_str()?.to_string(),
                        version: p["version"].as_str().unwrap_or("").to_string(),
                        description: p["description"].as_str().unwrap_or("").to_string(),
                        url: format!("https://www.npmjs.com/package/{}", p["name"].as_str()?),
                        downloads: o["downloads"]["weekly"].as_u64().unwrap_or(0),
                    })
                })
                .collect())
        }
        "cargo" => {
            let json = get(format!(
                "https://crates.io/api/v1/crates?q={}&per_page={limit}",
                urlencode(query)
            ))
            .await?;
            let empty = Vec::new();
            Ok(json["crates"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .filter_map(|c| {
                    Some(RegistryPackage {
                        name: c["name"].as_str()?.to_string(),
                        version: c["max_stable_version"]
                            .as_str()
                            .or(c["max_version"].as_str())
                            .unwrap_or("")
                            .to_string(),
                        description: c["description"].as_str().unwrap_or("").to_string(),
                        url: format!("https://crates.io/crates/{}", c["name"].as_str()?),
                        downloads: c["downloads"].as_u64().unwrap_or(0),
                    })
                })
                .collect())
        }
        "pip" => {
            // PyPI has no search API anymore; do an exact-name lookup.
            let json = get(format!("https://pypi.org/pypi/{}/json", urlencode(query))).await?;
            let info = &json["info"];
            match info["name"].as_str() {
                Some(name) => Ok(vec![RegistryPackage {
                    name: name.to_string(),
                    version: info["version"].as_str().unwrap_or("").to_string(),
                    description: info["summary"].as_str().unwrap_or("").to_string(),
                    url: format!("https://pypi.org/project/{name}/"),
                    downloads: 0,
                }]),
                None => Ok(Vec::new()),
            }
        }
        other => Err(Error::InvalidInput(format!("unknown registry: {other}"))),
    }
}

/// Latest published versions for a set of packages (`kind` as above).
/// Returns name → latest version; packages that fail to resolve are skipped.
pub async fn latest_versions(kind: &str, names: &[String]) -> Result<HashMap<String, String>> {
    let client = client(15_000)?;
    let mut out = HashMap::new();
    for name in names.iter().take(60) {
        let url = match kind {
            "npm" => format!("https://registry.npmjs.org/{}/latest", urlencode(name)),
            "cargo" => format!("https://crates.io/api/v1/crates/{}", urlencode(name)),
            "pip" => format!("https://pypi.org/pypi/{}/json", urlencode(name)),
            other => return Err(Error::InvalidInput(format!("unknown registry: {other}"))),
        };
        let Ok(resp) = client.get(&url).send().await else {
            continue;
        };
        let Ok(json) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let version = match kind {
            "npm" => json["version"].as_str(),
            "cargo" => json["crate"]["max_stable_version"]
                .as_str()
                .or(json["crate"]["max_version"].as_str()),
            _ => json["info"]["version"].as_str(),
        };
        if let Some(v) = version {
            out.insert(name.clone(), v.to_string());
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// OSV vulnerability lookup
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct VulnAdvisory {
    pub package: String,
    pub id: String,
    pub summary: String,
    pub severity: String,
    pub url: String,
}

/// Aggregate counts of advisories by coarse severity, for a status-bar badge
/// / summary line.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct VulnSummary {
    pub total: usize,
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub unknown: usize,
}

/// Bucket a raw OSV severity string (a label like `HIGH` or a CVSS vector) into
/// a coarse level for aggregation.
pub fn severity_bucket(raw: &str) -> &'static str {
    let s = raw.to_ascii_uppercase();
    if s.contains("CRITICAL") {
        "CRITICAL"
    } else if s.contains("HIGH") {
        "HIGH"
    } else if s.contains("MODERATE") || s.contains("MEDIUM") {
        "MEDIUM"
    } else if s.contains("LOW") {
        "LOW"
    } else {
        "UNKNOWN"
    }
}

/// Summarize a list of advisories by severity bucket.
pub fn summarize_vulns(advisories: &[VulnAdvisory]) -> VulnSummary {
    let mut out = VulnSummary {
        total: advisories.len(),
        ..Default::default()
    };
    for a in advisories {
        match severity_bucket(&a.severity) {
            "CRITICAL" => out.critical += 1,
            "HIGH" => out.high += 1,
            "MEDIUM" => out.medium += 1,
            "LOW" => out.low += 1,
            _ => out.unknown += 1,
        }
    }
    out
}

/// Extract a human-readable severity from an OSV vuln record.
///
/// OSV exposes severity in a couple of shapes: a `database_specific.severity`
/// label (e.g. "HIGH") and/or a `severity` array of `{type, score}` where the
/// score is a CVSS vector. We surface the label when present, else the CVSS.
fn osv_severity(vuln: &serde_json::Value) -> String {
    if let Some(s) = vuln["database_specific"]["severity"].as_str() {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    if let Some(first) = vuln["severity"].as_array().and_then(|a| a.first()) {
        let ty = first["type"].as_str().unwrap_or("");
        let score = first["score"].as_str().unwrap_or("");
        if !score.is_empty() {
            return if ty.is_empty() {
                score.to_string()
            } else {
                format!("{ty}: {score}")
            };
        }
    }
    String::new()
}

fn osv_ecosystem(kind: &str) -> Option<&'static str> {
    match kind {
        "npm" => Some("npm"),
        "cargo" => Some("crates.io"),
        "pip" => Some("PyPI"),
        _ => None,
    }
}

/// Query OSV.dev for known vulnerabilities of exact package versions.
/// `packages` are (name, version) pairs.
pub async fn osv_check(kind: &str, packages: &[(String, String)]) -> Result<Vec<VulnAdvisory>> {
    let eco = osv_ecosystem(kind)
        .ok_or_else(|| Error::InvalidInput(format!("unknown ecosystem {kind}")))?;
    let queries: Vec<serde_json::Value> = packages
        .iter()
        .take(100)
        .filter(|(_, v)| !v.is_empty())
        .map(|(name, version)| {
            serde_json::json!({
                "package": { "name": name, "ecosystem": eco },
                "version": version,
            })
        })
        .collect();
    if queries.is_empty() {
        return Ok(Vec::new());
    }
    let client = client(20_000)?;
    let resp = client
        .post("https://api.osv.dev/v1/querybatch")
        .json(&serde_json::json!({ "queries": queries }))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    let empty = Vec::new();
    let results = resp["results"].as_array().unwrap_or(&empty);
    let queried: Vec<&(String, String)> = packages
        .iter()
        .take(100)
        .filter(|(_, v)| !v.is_empty())
        .collect();
    // `querybatch` only returns vuln *ids* (no summary/severity) — collect them,
    // then fetch each vuln's details so the advisories are actually useful.
    let mut ids: Vec<(String, String)> = Vec::new(); // (package, vuln id)
    for (i, result) in results.iter().enumerate() {
        let Some((name, _)) = queried.get(i).map(|p| (**p).clone()) else {
            continue;
        };
        for vuln in result["vulns"].as_array().unwrap_or(&empty) {
            if let Some(id) = vuln["id"].as_str() {
                ids.push((name.clone(), id.to_string()));
            }
        }
    }

    let mut out = Vec::new();
    for (name, id) in ids.into_iter().take(100) {
        let (summary, severity) = match client
            .get(format!("https://api.osv.dev/v1/vulns/{id}"))
            .send()
            .await
        {
            Ok(r) => match r.json::<serde_json::Value>().await {
                Ok(detail) => (
                    detail["summary"].as_str().unwrap_or("").to_string(),
                    osv_severity(&detail),
                ),
                Err(_) => (String::new(), String::new()),
            },
            Err(_) => (String::new(), String::new()),
        };
        out.push(VulnAdvisory {
            package: name,
            url: format!("https://osv.dev/vulnerability/{id}"),
            id,
            summary,
            severity,
        });
    }
    Ok(out)
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'@' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_basics() {
        assert_eq!(urlencode("react"), "react");
        assert_eq!(urlencode("@types/node"), "@types/node");
        assert_eq!(urlencode("a b+c"), "a%20b%2Bc");
    }

    #[test]
    fn request_validation() {
        let req = HttpRequest {
            method: "GET".into(),
            url: "ftp://example.com".into(),
            headers: vec![],
            body: String::new(),
            timeout_ms: None,
            block_private: false,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(http_request(req));
        assert!(err.is_err());
    }

    #[test]
    fn private_host_detection() {
        assert!(is_private_host("localhost"));
        assert!(is_private_host("127.0.0.1"));
        assert!(is_private_host("10.0.0.5"));
        assert!(is_private_host("192.168.1.1"));
        assert!(is_private_host("169.254.10.1")); // link-local
        assert!(is_private_host("::1"));
        assert!(is_private_host("[fe80::1]"));
        assert!(is_private_host("fc00::1"));
        assert!(!is_private_host("8.8.8.8"));
        assert!(!is_private_host("example.com")); // hostname, not resolved
        assert!(!is_private_host("93.184.216.34"));
    }

    #[test]
    fn ssrf_guard_blocks_private_when_enabled() {
        let req = HttpRequest {
            method: "GET".into(),
            url: "http://127.0.0.1:8080/admin".into(),
            headers: vec![],
            body: String::new(),
            timeout_ms: None,
            block_private: true,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(http_request(req));
        assert!(err.is_err(), "private host blocked when guard is on");
    }

    #[test]
    fn vuln_severity_bucketing_and_summary() {
        assert_eq!(severity_bucket("CRITICAL"), "CRITICAL");
        assert_eq!(severity_bucket("high"), "HIGH");
        assert_eq!(severity_bucket("Moderate"), "MEDIUM");
        assert_eq!(severity_bucket("MEDIUM"), "MEDIUM");
        assert_eq!(severity_bucket("low"), "LOW");
        assert_eq!(severity_bucket("CVSS_V3: CVSS:3.1/..."), "UNKNOWN");

        let adv = |sev: &str| VulnAdvisory {
            package: "p".into(),
            id: "X".into(),
            summary: String::new(),
            severity: sev.into(),
            url: String::new(),
        };
        let s = summarize_vulns(&[adv("HIGH"), adv("high"), adv("LOW"), adv("weird")]);
        assert_eq!(
            s,
            VulnSummary {
                total: 4,
                high: 2,
                low: 1,
                unknown: 1,
                ..Default::default()
            }
        );
    }

    #[test]
    fn osv_severity_extraction() {
        // database_specific.severity label wins.
        let v = serde_json::json!({ "database_specific": { "severity": "HIGH" } });
        assert_eq!(osv_severity(&v), "HIGH");
        // else fall back to the CVSS vector in the severity array.
        let v = serde_json::json!({
            "severity": [{ "type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/.../A:H" }]
        });
        assert_eq!(osv_severity(&v), "CVSS_V3: CVSS:3.1/AV:N/AC:L/.../A:H");
        // nothing → empty.
        assert_eq!(osv_severity(&serde_json::json!({ "id": "X" })), "");
    }

    #[test]
    fn osv_ecosystem_mapping() {
        assert_eq!(osv_ecosystem("npm"), Some("npm"));
        assert_eq!(osv_ecosystem("cargo"), Some("crates.io"));
        assert_eq!(osv_ecosystem("pip"), Some("PyPI"));
        assert_eq!(osv_ecosystem("go"), None);
    }
}

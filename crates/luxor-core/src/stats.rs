//! System statistics for the status bar: CPU, memory, network throughput and
//! a lightweight TCP "ping".
//!
//! CPU usage and network rates are deltas between consecutive samples, so the
//! sampler keeps state and should be reused (one instance per app).

use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sysinfo::{MemoryRefreshKind, Networks, RefreshKind, System};

/// One snapshot of system stats. Rates are `None` on the very first sample.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemStats {
    /// Global CPU usage, 0..=100.
    pub cpu_percent: f32,
    /// Used physical memory in bytes.
    pub mem_used: u64,
    /// Total physical memory in bytes.
    pub mem_total: u64,
    /// Download rate in bytes/second across all interfaces.
    pub net_rx_bps: Option<u64>,
    /// Upload rate in bytes/second across all interfaces.
    pub net_tx_bps: Option<u64>,
}

/// Stateful sampler; call [`StatsSampler::sample`] periodically.
pub struct StatsSampler {
    sys: System,
    networks: Networks,
    last_sample: Option<Instant>,
    last_rx: u64,
    last_tx: u64,
}

impl Default for StatsSampler {
    fn default() -> Self {
        Self::new()
    }
}

impl StatsSampler {
    pub fn new() -> Self {
        let refresh = RefreshKind::nothing()
            .with_cpu(sysinfo::CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::everything());
        Self {
            sys: System::new_with_specifics(refresh),
            networks: Networks::new_with_refreshed_list(),
            last_sample: None,
            last_rx: 0,
            last_tx: 0,
        }
    }

    /// Take a snapshot. Network rates need at least two samples.
    pub fn sample(&mut self) -> SystemStats {
        self.sys.refresh_cpu_usage();
        self.sys
            .refresh_memory_specifics(MemoryRefreshKind::everything());
        self.networks.refresh(true);

        let (rx, tx) = self
            .networks
            .iter()
            .fold((0u64, 0u64), |(rx, tx), (_, data)| {
                (
                    rx.saturating_add(data.total_received()),
                    tx.saturating_add(data.total_transmitted()),
                )
            });

        let now = Instant::now();
        let (net_rx_bps, net_tx_bps) = match self.last_sample {
            Some(prev) => {
                let secs = now.duration_since(prev).as_secs_f64().max(0.001);
                (
                    Some((rx.saturating_sub(self.last_rx) as f64 / secs) as u64),
                    Some((tx.saturating_sub(self.last_tx) as f64 / secs) as u64),
                )
            }
            None => (None, None),
        };
        self.last_sample = Some(now);
        self.last_rx = rx;
        self.last_tx = tx;

        SystemStats {
            cpu_percent: self.sys.global_cpu_usage().clamp(0.0, 100.0),
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            net_rx_bps,
            net_tx_bps,
        }
    }
}

/// Measure latency by timing a TCP connect to `host:port`.
///
/// Returns `None` when the host cannot be resolved or the connect fails or
/// times out. DNS resolution is blocking — call from a worker thread.
pub fn tcp_ping(host_port: &str, timeout: Duration) -> Option<u32> {
    let addr = host_port.to_socket_addrs().ok()?.next()?;
    let start = Instant::now();
    TcpStream::connect_timeout(&addr, timeout).ok()?;
    Some(start.elapsed().as_millis().min(u128::from(u32::MAX)) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampler_produces_sane_values() {
        let mut sampler = StatsSampler::new();
        let first = sampler.sample();
        assert!(first.mem_total > 0);
        assert!(first.mem_used <= first.mem_total);
        assert!(first.net_rx_bps.is_none(), "no rate on first sample");
        std::thread::sleep(Duration::from_millis(60));
        let second = sampler.sample();
        assert!((0.0..=100.0).contains(&second.cpu_percent));
        assert!(second.net_rx_bps.is_some());
        assert!(second.net_tx_bps.is_some());
    }

    #[test]
    fn ping_handles_bad_hosts() {
        assert_eq!(
            tcp_ping(
                "definitely-not-a-host.invalid:1",
                Duration::from_millis(100)
            ),
            None
        );
        assert_eq!(
            tcp_ping("not even an address", Duration::from_millis(100)),
            None
        );
    }
}

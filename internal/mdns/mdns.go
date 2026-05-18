// Package mdns advertises the diffmil server's hostname over multicast DNS
// so that other devices on the same LAN can reach it via "<host>.local".
package mdns

import (
	"fmt"
	"net"
	"strings"

	hmdns "github.com/hashicorp/mdns"
)

// DefaultHostname is the host label advertised over mDNS unless overridden
// via the --mdns-host CLI flag. The trailing ".local" is appended automatically.
const DefaultHostname = "difmil"

// Start begins advertising <hostname>.local on the local network and returns
// a shutdown function. The hostname must not include the ".local" suffix.
func Start(hostname string, port int) (func() error, error) {
	hostname = strings.TrimSuffix(hostname, ".local")
	hostname = strings.TrimSuffix(hostname, ".")
	if hostname == "" {
		return nil, fmt.Errorf("mdns: hostname must not be empty")
	}

	ips, err := localIPs()
	if err != nil {
		return nil, fmt.Errorf("mdns: could not enumerate local IPs: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("mdns: no usable local IPv4 addresses found")
	}

	svc, err := hmdns.NewMDNSService(
		hostname,        // instance
		"_http._tcp",    // service type
		"",              // domain (defaults to "local.")
		hostname+".",    // hostname FQDN under .local
		port,
		ips,
		[]string{"diffmil"},
	)
	if err != nil {
		return nil, fmt.Errorf("mdns: failed to build service: %w", err)
	}

	srv, err := hmdns.NewServer(&hmdns.Config{Zone: svc})
	if err != nil {
		return nil, fmt.Errorf("mdns: failed to start server: %w", err)
	}

	return srv.Shutdown, nil
}

func localIPs() ([]net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var out []net.IP
	for _, ifi := range ifaces {
		if ifi.Flags&net.FlagUp == 0 || ifi.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifi.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			if ip4 := ip.To4(); ip4 != nil {
				out = append(out, ip4)
			}
		}
	}
	return out, nil
}

import { execFile } from 'child_process'
import { promisify } from 'util'
import { DEFAULT_HTTP_PORT, DEFAULT_WS_PORT, DISCOVERY_PORT } from '../shared/types'

const execFileAsync = promisify(execFile)

interface FirewallRule {
  name: string
  protocol: 'UDP' | 'TCP'
  port: number
}

function rules(httpPort: number, wsPort: number): FirewallRule[] {
  return [
    { name: 'LanComm Discovery UDP', protocol: 'UDP', port: DISCOVERY_PORT },
    { name: 'LanComm Transfer TCP', protocol: 'TCP', port: httpPort },
    { name: 'LanComm Message TCP', protocol: 'TCP', port: wsPort }
  ]
}

async function ruleExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`])
    return true
  } catch {
    return false
  }
}

/**
 * Best effort only: adding rules needs elevation, and the app stays usable without it
 * as long as the user answers the Windows firewall prompt.
 */
export async function ensureWindowsFirewallRules(
  httpPort: number = DEFAULT_HTTP_PORT,
  wsPort: number = DEFAULT_WS_PORT
): Promise<void> {
  if (process.platform !== 'win32') return

  for (const rule of rules(httpPort, wsPort)) {
    if (await ruleExists(rule.name)) continue

    try {
      await execFileAsync('netsh', [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        `name=${rule.name}`,
        'dir=in',
        'action=allow',
        `protocol=${rule.protocol}`,
        `localport=${rule.port}`,
        'profile=private,domain'
      ])
      console.log('[firewall] added rule', rule.name)
    } catch {
      console.log('[firewall] skipped', rule.name, '(需要管理员权限)')
    }
  }
}

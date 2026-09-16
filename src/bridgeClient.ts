import * as http from 'http';

export interface TDResponse {
    stdout: string;
    result: string;
    error: string | null;
}

export interface TDConnectionInfo {
    connected: boolean;
    version?: string;
    python?: string;
}

/**
 * HTTP client that talks to the TouchDesigner Bridge server
 * running inside TD on localhost.
 */
export class TDBridgeClient {
    private host: string;
    private port: number;
    private timeout: number;

    constructor(host: string, port: number, timeout: number = 10000) {
        this.host = host;
        this.port = port;
        this.timeout = timeout;
    }

    get endpoint(): string {
        return `http://${this.host}:${this.port}`;
    }

    /**
     * Test connection by sending a harmless eval that returns TD version info.
     */
    async testConnection(): Promise<TDConnectionInfo> {
        try {
            const resp = await this.execute(
                "import td; __td_ver = td.version() if hasattr(td, 'version') else 'unknown'; __py_ver = __import__('sys').version.split()[0]",
                true
            );
            // Try a second eval to get the actual values
            const versionResp = await this.execute(
                "getattr(__import__('td'), 'version', lambda: 'unknown')()",
                true
            );
            const pythonResp = await this.execute(
                "__import__('sys').version.split()[0]",
                true
            );

            const version = versionResp.result
                ? versionResp.result.replace(/['"]/g, '')
                : undefined;
            const python = pythonResp.result
                ? pythonResp.result.replace(/['"]/g, '')
                : undefined;

            return {
                connected: true,
                version: version || 'unknown',
                python: python || 'unknown',
            };
        } catch {
            throw new Error(`Cannot reach TouchDesigner at ${this.host}:${this.port}`);
        }
    }

    /**
     * Execute Python code in TD's global scope.
     * @param code Python source code
     * @param evalMode If true, use eval() (returns a value). If false, use exec().
     */
    async execute(code: string, evalMode: boolean = false): Promise<TDResponse> {
        const payload = JSON.stringify({
            code: code,
            mode: evalMode ? 'eval' : 'exec',
        });

        return new Promise<TDResponse>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: this.host,
                    port: this.port,
                    path: '/',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                    },
                    timeout: this.timeout,
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: Buffer) => {
                        data += chunk.toString();
                    });
                    res.on('end', () => {
                        try {
                            // Strip HTTP headers if somehow included (shouldn't be with http module)
                            const jsonStart = data.indexOf('{');
                            const jsonStr = jsonStart >= 0 ? data.slice(jsonStart) : data;
                            const parsed = JSON.parse(jsonStr) as TDResponse;
                            resolve(parsed);
                        } catch (err) {
                            reject(new Error(`Invalid response from TD: ${data.substring(0, 200)}`));
                        }
                    });
                }
            );

            req.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ECONNREFUSED') {
                    reject(new Error(`Connection refused — is the TD bridge running on ${this.host}:${this.port}?`));
                } else if (err.code === 'ETIMEDOUT') {
                    reject(new Error(`Request timed out after ${this.timeout}ms`));
                } else {
                    reject(err);
                }
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timed out after ${this.timeout}ms`));
            });

            req.write(payload);
            req.end();
        });
    }
}
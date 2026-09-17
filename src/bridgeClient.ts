import * as http from 'http';

export type TDExecMode = 'auto' | 'eval' | 'exec';

export interface TDResponse {
    stdout: string;
    result: string;
    error: string | null;
}

export interface TDConnectionInfo {
    connected: boolean;
    version?: string;
    python?: string;
    product?: string;
}

// Returns "python|build|product". TD's `app` is reached via the td module because
// DAT globals() does not contain it, even though bare names like absTime resolve.
const PROBE_EXPR =
    "__import__('sys').version.split()[0]" +
    " + '|' + str(getattr(__import__('td').app, 'build', ''))" +
    " + '|' + str(getattr(__import__('td').app, 'product', ''))";

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
     * Test connection by evaluating a harmless expression that also reports
     * the Python and TouchDesigner versions.
     */
    async testConnection(): Promise<TDConnectionInfo> {
        const resp = await this.execute(PROBE_EXPR, 'eval');

        // A reachable bridge is "connected" even if the probe expression failed.
        if (resp.error) {
            return { connected: true };
        }

        const [python, version, product] = resp.result
            .replace(/^['"]|['"]$/g, '')
            .split('|');

        return {
            connected: true,
            python: python || undefined,
            version: version || undefined,
            product: product || undefined,
        };
    }

    /**
     * Execute Python code in TD's global scope.
     * @param mode 'auto' lets TD compile-test the code and return a value when it is an expression.
     */
    async execute(code: string, mode: TDExecMode = 'auto'): Promise<TDResponse> {
        const payload = JSON.stringify({ code, mode });

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
                    reject(new Error(`Connection refused — is the Web Server DAT active on ${this.host}:${this.port}?`));
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
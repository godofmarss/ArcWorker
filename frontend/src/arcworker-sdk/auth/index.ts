import { ArcWorker } from '../index';
import axios from 'axios';

export class AuthModule {
    private sdk: ArcWorker;
    private userToken: string | null = null;
    private encryptionKey: string | null = null;

    constructor(sdk: ArcWorker) {
        this.sdk = sdk;
        // Restore session if available
        if (typeof localStorage !== 'undefined') {
            this.userToken = localStorage.getItem('arc_session_token');
            this.encryptionKey = localStorage.getItem('arc_encryption_key');
        }
    }

    /**
     * Start the login flow via Email
     * @param email User email
     * @returns Challenge status or Direct success if session active
     */
    public async loginWithEmail(email: string): Promise<{ address: string }> {
        if (this.userToken && this.encryptionKey) {
            return { address: await this.getWalletAddress() };
        }

        const circleSdk = this.sdk.getCircleSdk();
        if (!circleSdk) throw new Error("SDK not initialized in browser");

        // Fix: persist device ID manually across mobile sessions
        let deviceId = localStorage.getItem('arc_device_id');
        if (!deviceId) {
            deviceId = await circleSdk.getDeviceId();
            if (deviceId) {
                localStorage.setItem('arc_device_id', deviceId);
            }
        } else {
            // Re-register the stored device ID with Circle SDK
            try {
                (circleSdk as any).setDeviceId(deviceId);
            } catch {
                // If setDeviceId not available, fall back to fresh one
                deviceId = await circleSdk.getDeviceId();
                localStorage.setItem('arc_device_id', deviceId);
            }
        }

        const authRes = await axios.post('/api/circle/auth/email', { email, deviceId });
        const { deviceToken, deviceEncryptionKey, otpToken, appId } = authRes.data;

        return new Promise((resolve, reject) => {
            circleSdk.updateConfigs({
                appSettings: { appId },
                loginConfigs: { deviceToken, deviceEncryptionKey, otpToken }
            }, async (error: any, result: any) => {
                if (error) reject(error);
                else if (result && result.userToken && result.encryptionKey) {
                    this.setSession(result.userToken, result.encryptionKey);
                    const address = await this.setupWallet();
                    resolve({ address });
                }
            });
            (circleSdk as any).verifyOtp();
        });
    }

    /**
     * Finalize Wallet Creation / Retrieval
     */
    private async setupWallet(): Promise<string> {
        if (!this.userToken) throw new Error("No session");

        const circleSdk = this.sdk.getCircleSdk();

        if (!this.encryptionKey) throw new Error("Encryption Key missing for session");

        // Authenticate SDK
        circleSdk?.setAuthentication({
            userToken: this.userToken,
            encryptionKey: this.encryptionKey
        });

        // Create Wallet
        const res = await axios.post('/api/circle/wallet', { userToken: this.userToken });
        const { challengeId, address } = res.data;

        if (challengeId && circleSdk) {
            await new Promise((resolve, reject) => {
                circleSdk.execute(challengeId, (err, res) => {
                    if (err) reject(err);
                    else resolve(res);
                });
            });
            return await this.pollAddress();
        }

        return address || await this.pollAddress();
    }

    private async pollAddress(): Promise<string> {
        let retries = 10;
        while (retries > 0) {
            const res = await axios.post('/api/circle/wallet/address', { userToken: this.userToken });
            if (res.data.address) return res.data.address;
            await new Promise(r => setTimeout(r, 2000));
            retries--;
        }
        throw new Error("Address generation timeout");
    }

    // Check Address (Public)
    public async getWalletAddress(): Promise<string> {
        return this.pollAddress();
    }

    private static readonly STORAGE_KEYS = [
        'arc_device_id',
        'arc_session_token',
        'arc_encryption_key',
        'arc_user',
        'arc_wallet_address',
        'arc_circle_user_id',
        'arc_contacts',
        'arc_social_pending',
        'arc_social_user_context',
        'arc_social_session_data'
    ];

    private setSession(token: string, key: string) {
        this.userToken = token;
        this.encryptionKey = key;
        localStorage.setItem('arc_session_token', token);
        localStorage.setItem('arc_encryption_key', key);
    }

    public logout() {
        this.userToken = null;
        this.encryptionKey = null;
        AuthModule.clearAllSessions();
    }

    public static clearAllSessions() {
        if (typeof localStorage === 'undefined') return;
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('arc_')) {
                localStorage.removeItem(key);
            }
        });
    }
}

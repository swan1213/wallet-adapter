import {
    SendTransactionOptions,
    WalletError,
    WalletNotConnectedError,
    WalletNotReadyError,
} from '@solana/wallet-adapter-base';
import { Wallet, WalletName } from '@solana/wallet-adapter-wallets';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import React, { FC, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { WalletNotSelectedError } from './errors';
import { useLocalStorage } from './useLocalStorage';
import { WalletContext } from './useWallet';

export interface WalletProviderProps {
    children: ReactNode;
    wallets: Wallet[];
    autoConnect?: boolean;
    onError?: (error: WalletError) => void;
    localStorageKey?: string;
}

export const WalletProvider: FC<WalletProviderProps> = ({
    children,
    wallets,
    autoConnect = false,
    onError = (error: WalletError) => console.error(error),
    localStorageKey = 'walletName',
}) => {
    const [name, setName] = useLocalStorage<WalletName | null>(localStorageKey, null);
    const [wallet, setWallet] = useState<Wallet>();
    const [adapter, setAdapter] = useState<ReturnType<Wallet['adapter']>>();
    const [ready, setReady] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [connected, setConnected] = useState(false);
    const [autoApprove, setAutoApprove] = useState(false);
    const [publicKey, setPublicKey] = useState<PublicKey | null>(null);

    const walletsByName = useMemo(
        () =>
            wallets.reduce((walletsByName, wallet) => {
                walletsByName[wallet.name] = wallet;
                return walletsByName;
            }, {} as { [name in WalletName]: Wallet }),
        [wallets]
    );

    const select = useCallback(
        async (selected: WalletName | null) => {
            if (name === selected) return;
            if (adapter) await adapter.disconnect();
            setName(selected);
        },
        [name, adapter, setName]
    );

    const reset = useCallback(() => {
        setReady(false);
        setConnecting(false);
        setDisconnecting(false);
        setConnected(false);
        setAutoApprove(false);
        setPublicKey(null);
    }, [setReady, setConnecting, setDisconnecting, setConnected, setAutoApprove, setPublicKey]);

    const onReady = useCallback(() => setReady(true), [setReady]);

    const onConnect = useCallback(() => {
        if (!adapter) return;

        setConnected(true);
        setAutoApprove(adapter.autoApprove);
        setPublicKey(adapter.publicKey);
    }, [adapter, setConnected, setAutoApprove, setPublicKey]);

    const onDisconnect = useCallback(() => reset(), [reset]);

    const connect = useCallback(async () => {
        if (connecting || disconnecting || connected) return;

        if (!wallet || !adapter) {
            const error = new WalletNotSelectedError();
            onError(error);
            throw error;
        }
        if (!ready) {
            window.open(wallet.url, '_blank');

            const error = new WalletNotReadyError();
            onError(error);
            throw error;
        }

        setConnecting(true);
        try {
            await adapter.connect();
        } finally {
            setConnecting(false);
        }
    }, [connecting, disconnecting, connected, adapter, onError, ready, wallet, setConnecting]);

    const disconnect = useCallback(async () => {
        if (disconnecting) return;

        if (!adapter) {
            await select(null);
            return;
        }

        setDisconnecting(true);
        try {
            await adapter.disconnect();
        } finally {
            setDisconnecting(false);
            await select(null);
        }
    }, [disconnecting, adapter, select, setDisconnecting]);

    const sendTransaction = useCallback(
        async (transaction: Transaction, connection: Connection, options?: SendTransactionOptions) => {
            if (!adapter) {
                const error = new WalletNotSelectedError();
                onError(error);
                throw error;
            }
            if (!connected) {
                const error = new WalletNotConnectedError();
                onError(error);
                throw error;
            }

            return await adapter.sendTransaction(transaction, connection, options);
        },
        [adapter, onError, connected]
    );

    const signTransaction = useMemo(
        () =>
            adapter && 'signTransaction' in adapter
                ? async (transaction: Transaction) => {
                      if (!connected) {
                          const error = new WalletNotConnectedError();
                          onError(error);
                          throw error;
                      }

                      return await adapter.signTransaction(transaction);
                  }
                : undefined,
        [adapter, onError, connected]
    );

    const signAllTransactions = useMemo(
        () =>
            adapter && 'signAllTransactions' in adapter
                ? async (transactions: Transaction[]) => {
                      if (!connected) {
                          const error = new WalletNotConnectedError();
                          onError(error);
                          throw error;
                      }

                      return await adapter.signAllTransactions(transactions);
                  }
                : undefined,
        [adapter, onError, connected]
    );

    const signMessage = useMemo(
        () =>
            adapter && 'signMessage' in adapter
                ? async <T extends Uint8Array | string>(message: T) => {
                      if (!connected) {
                          const error = new WalletNotConnectedError();
                          onError(error);
                          throw error;
                      }

                      return await adapter.signMessage(message);
                  }
                : undefined,
        [adapter, onError, connected]
    );

    // Reset state and set the wallet, adapter, and ready state when the name changes
    useEffect(() => {
        reset();

        const wallet = name ? walletsByName[name] : undefined;
        const adapter = wallet ? wallet.adapter() : undefined;

        setWallet(wallet);
        setAdapter(adapter);
        setReady(adapter ? adapter.ready : false);
    }, [reset, name, walletsByName, setWallet, setAdapter, setReady]);

    // Setup and teardown event listeners when the adapter changes
    useEffect(() => {
        if (adapter) {
            adapter.on('ready', onReady);
            adapter.on('connect', onConnect);
            adapter.on('disconnect', onDisconnect);
            adapter.on('error', onError);
            return () => {
                adapter.off('ready', onReady);
                adapter.off('connect', onConnect);
                adapter.off('disconnect', onDisconnect);
                adapter.off('error', onError);
            };
        }
    }, [adapter, onReady, onConnect, onDisconnect, onError]);

    // If autoConnect is enabled, try to connect when the adapter changes and is ready
    useEffect(() => {
        if (autoConnect && adapter && ready) {
            (async function () {
                setConnecting(true);
                try {
                    await adapter.connect();
                } catch (error: any) {
                    // Don't throw error, but onError will still be called
                } finally {
                    setConnecting(false);
                }
            })();
        }
    }, [autoConnect, adapter, ready, setConnecting]);

    return (
        <WalletContext.Provider
            value={{
                wallets,
                autoConnect,
                select,
                wallet,
                adapter,
                publicKey,
                ready,
                connecting,
                disconnecting,
                connected,
                autoApprove,
                connect,
                disconnect,
                sendTransaction,
                signTransaction,
                signAllTransactions,
                signMessage,
            }}
        >
            {children}
        </WalletContext.Provider>
    );
};

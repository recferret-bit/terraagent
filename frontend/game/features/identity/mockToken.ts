export {
  buildFastAuthLoginUrl,
  buildNearWalletLoginUrl,
  consumeNearWalletCallback,
  NEAR_FASTAUTH_CLIENT_ID,
  NEAR_FASTAUTH_ISSUER,
  NEAR_TESTNET_WALLET_LOGIN_URL,
  OAUTH_CALLBACK_STORAGE_KEY,
  readMockToken,
  readOAuthStorageEvent,
  type MockToken,
  type MockTokenMessage,
} from '../../../design/pilot/mockToken';
export {
  openNearWalletSelectorModal,
  readSavedNearWallet,
  saveNearWallet,
} from '../../../design/pilot/nearWalletModal';

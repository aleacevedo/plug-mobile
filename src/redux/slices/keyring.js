import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import PlugController from '@psychedelic/plug-mobile-controller';
import { keyringStorage } from '../configureReducer';
import RNCryptoJS from 'react-native-crypto-js';
import { fetch } from 'react-native-fetch-api';
import { formatAssets, formatAssetBySymbol } from '../../utils/assets';
import { ACTIVITY_STATUS } from '../../screens/Profile/components/constants';
import { TOKEN_IMAGES } from '../../utils/assets';

export const recursiveParseBigint = obj =>
  Object.entries(obj).reduce(
    (acum, [key, val]) => {
      if (val instanceof Object) {
        const res = Array.isArray(val)
          ? val.map(el => recursiveParseBigint(el))
          : recursiveParseBigint(val);
        return { ...acum, [key]: res };
      }
      if (typeof val === 'bigint') {
        return { ...acum, [key]: parseInt(val.toString(), 10) };
      }
      return { ...acum, [key]: val };
    },
    { ...obj },
  );

export const initKeyring = createAsyncThunk('keyring/init', async () => {
  let keyring = new PlugController.PlugKeyRing(
    keyringStorage,
    RNCryptoJS,
    fetch,
  );
  await keyring.init();
  if (keyring?.isUnlocked) {
    const state = await keyring.getState();
    if (!state.wallets.length) {
      await keyring.lock();
    }
  }
  return keyring;
});

export const getAssets = createAsyncThunk(
  'keyring/getAssets',
  async ({ refresh, icpPrice }, { getState }) => {
    try {
      const { instance } = getState().keyring;
      const response = await instance?.getState();
      const { wallets, currentWalletId } = response || {};
      let assets = wallets?.[currentWalletId]?.assets || [];
      if (
        !assets.length ||
        assets?.every(asset => parseFloat(asset.amount) <= 0) ||
        refresh
      ) {
        assets = await instance?.getBalance();
      } else {
        instance?.getBalance();
      }
      return { assets, icpPrice };
    } catch (e) {
      console.log('getAssets', e);
    }
  },
);

export const getNFTs = createAsyncThunk(
  'keyring/getNFTs',
  async (refresh, { getState }) => {
    try {
      const { instance } = getState().keyring;
      const response = await instance?.getState();
      const { wallets, currentWalletId } = response || {};
      let collections = wallets?.[currentWalletId]?.collections || [];
      if (!collections.length) {
        collections = await instance.getNFTs(currentWalletId, refresh);
      }
      return (collections || [])?.map(collection =>
        recursiveParseBigint(collection),
      );
    } catch (e) {
      console.log('getNFTs', e);
    }
  },
);

export const createSubaccount = createAsyncThunk(
  'keyring/createSubaccount',
  async (params, { getState }) => {
    try {
      const state = getState();
      const response = await state.keyring.instance?.createPrincipal(params);
      return response;
    } catch (e) {
      console.log('createSubaccount', e);
    }
  },
);

export const editSubaccount = createAsyncThunk(
  'keyring/editSubaccount',
  async (params, { getState }) => {
    try {
      const state = getState();
      await state.keyring.instance?.editPrincipal(params.walletNumber, {
        name: params.name,
        emoji: params.icon,
      });

      const response = state.keyring.instance?.getState();
      const { wallets } = response;
      return wallets[params.walletNumber]; //tell rocky to make the edit return the edited account
    } catch (e) {
      console.log('editSubaccount', e);
    }
  },
);

export const burnXtc = createAsyncThunk(
  'keyring/burnXtc',
  async (params, { getState }) => {
    try {
      const state = getState();
      const response = await state.keyring.instance?.burnXTC(params);
      return {
        response: recursiveParseBigint(response),
        status: TRANSACTION_STATUS.success,
      };
    } catch (e) {
      console.log('burnXtc', e);
      return {
        error: e.message,
        status: TRANSACTION_STATUS.error,
      };
    }
  },
);

export const sendToken = createAsyncThunk(
  'keyring/sendToken',
  async (params, { getState }) => {
    try {
      const { to, amount, canisterId, opts } = params;
      const state = getState();
      const { height, transactionId } = await state.keyring.instance?.send(
        to,
        amount.toString(),
        canisterId,
        opts,
      );
      return {
        response: {
          height: parseInt(height?.toString?.(), 10),
          transactionId: parseInt(transactionId?.toString?.(), 10),
        },
        status: TRANSACTION_STATUS.success,
      };
    } catch (e) {
      console.log('sendToken', e);
      return {
        error: e.message,
        status: TRANSACTION_STATUS.error,
      };
    }
  },
);

export const transferNFT = createAsyncThunk(
  'keyring/transferNFT',
  async (params, { getState }) => {
    try {
      const { to, nft } = params;

      const state = getState();
      const response = await state.keyring.instance?.transferNFT({
        to,
        token: nft,
      });

      return {
        response: recursiveParseBigint(response),
        nft,
        status: TRANSACTION_STATUS.success,
      };
    } catch (e) {
      console.log('transferNFT', e);
      console.trace(e.stack);
      return {
        error: e.message,
        status: TRANSACTION_STATUS.error,
      };
    }
  },
);

export const getTransactions = createAsyncThunk(
  'keyring/getTransactions',
  async (params, { getState }) => {
    try {
      const { icpPrice } = params;
      const state = getState();
      const response = await state.keyring.instance?.getTransactions();

      const mapTransaction = trx => {
        const asset = formatAssetBySymbol(
          trx?.details?.amount,
          trx?.details?.currency?.symbol,
          icpPrice,
        );
        const isOwnTx = [state.principalId, state.accountId].includes(
          trx?.caller,
        );
        const getType = () => {
          const { type } = trx;
          if (type.toUpperCase() === 'TRANSFER') {
            return isOwnTx ? 'SEND' : 'RECEIVE';
          }
          return type.toUpperCase();
        };
        const transaction = {
          ...asset,
          type: getType(),
          hash: trx?.hash,
          to: trx?.details?.to,
          from: trx?.details?.from || trx?.caller,
          date: new Date(trx?.timestamp),
          status: ACTIVITY_STATUS[trx?.details?.status],
          image:
            TOKEN_IMAGES[trx?.details?.currency?.symbol] ||
            trx?.canisterInfo?.icon ||
            '',
          symbol:
            trx?.details?.currency?.symbol ?? (trx?.canisterInfo ? 'NFT' : ''),
          canisterId: trx?.details?.canisterId,
          plug: null,
          canisterInfo: trx?.canisterInfo,
          details: { ...trx?.details, caller: trx?.caller },
        };
        return transaction;
      };
      const parsedTrx = response.transactions?.map(mapTransaction) || [];

      return parsedTrx;
    } catch (e) {
      console.log('getTransactions', e);
      return {
        error: e.message,
      };
    }
  },
);

const DEFAULT_ASSETS = [
  {
    symbol: 'ICP',
    name: 'ICP',
    amount: 0,
    value: 0,
    icon: 'dfinity',
  },
  {
    symbol: 'XTC',
    name: 'Cycles',
    amount: 0,
    value: 0,
    icon: 'xtc',
  },
];

const DEFAULT_TRANSACTION = {
  height: null,
  transactionId: null,
  status: null,
};

export const TRANSACTION_STATUS = {
  success: 'success',
  error: 'error',
};

const DEFAULT_STATE = {
  instance: null,
  assets: DEFAULT_ASSETS,
  assetsLoading: true,
  isInitialized: false,
  isUnlocked: false,
  currentWallet: null,
  wallets: [],
  password: '',
  contacts: [],
  transaction: DEFAULT_TRANSACTION,
  transactions: [],
  transactionsLoading: true,
  selectedNFT: {},
};

export const keyringSlice = createSlice({
  name: 'keyring',
  initialState: DEFAULT_STATE,
  reducers: {
    setCurrentWallet: (state, action) => {
      state.currentWallet = action.payload;
    },
    setUnlocked: (state, action) => {
      state.isUnlocked = action.payload;
    },
    setWallets: (state, action) => {
      state.wallets = action.payload;
    },
    setContacts: (state, action) => {
      state.contacts = action.payload;
    },
    addContact: (state, action) => {
      state.contacts.push(action.payload);
    },
    removeContact: (state, action) => {
      state.contacts = state.contacts.filter(
        contact => contact.id !== action.payload.id,
      );
    },
    setAssetsLoading: (state, action) => {
      state.assetsLoading = action.payload;
    },
    setTransaction: (state, action) => {
      state.transaction = action.payload;
    },
    setSelectedNFT: (state, action) => {
      state.selectedNFT = action.payload;
    },
    setCollections: (state, action) => {
      state.collections = action.payload;
    },
    removeNFT: (state, action) => {
      const collections = state.collections.map(col => ({
        ...col,
        tokens: col.tokens.filter(token => token.id !== action.payload?.id),
      }));
      state.collections = collections.filter(col => col.tokens.length);
    },
    setTransactions: (state, action) => {},
    setTransactionsLoading: (state, action) => {
      state.transactionsLoading = action.payload;
    },
    reset: state => {
      state = DEFAULT_STATE;
    },
  },
  extraReducers: {
    [initKeyring.fulfilled]: (state, action) => {
      state.instance = action.payload;
      state.isInitialized = action.payload.isInitialized;
      state.isUnlocked = action.payload.isUnlocked;
    },
    [createSubaccount.fulfilled]: (state, action) => {
      state.wallets = [...state.wallets, action.payload];
    },
    [editSubaccount.fulfilled]: (state, action) => {
      const account = action.payload;
      state.wallets = state.wallets.map(a =>
        a.walletNumber === account.walletNumber ? account : a,
      );
    },
    [sendToken.fulfilled]: (state, action) => {
      state.transaction = action.payload;
    },
    [burnXtc.fulfilled]: (state, action) => {
      state.transaction = action.payload;
    },
    [getAssets.fulfilled]: (state, action) => {
      const formattedAssets = formatAssets(action.payload);
      state.assets =
        formattedAssets?.length > 0 ? formattedAssets : DEFAULT_ASSETS;
      state.assetsLoading = false;
    },
    [getNFTs.fulfilled]: (state, action) => {
      state.collections = action.payload;
    },
    [getTransactions.fulfilled]: (state, action) => {
      if (!action.payload.error) {
        state.transactions = action.payload;
        state.transactionsLoading = false;
      }
    },
    [transferNFT.fulfilled]: (state, action) => {
      const { nft, status, error } = action.payload;

      if (!error) {
        const collections = state.collections.map(col => ({
          ...col,
          tokens: col.tokens.filter(token => token.id !== nft.id),
        }));

        state.collections = collections.filter(col => col.tokens.length);
        state.transaction = {
          status,
        };
        state.selectedNFT = {};
      }
    },
  },
});

export const {
  setCurrentWallet,
  setUnlocked,
  addContact,
  removeContact,
  setContacts,
  setWallets,
  setAssetsLoading,
  setTransaction,
  setSelectedNFT,
  setTransactions,
  setTransactionsLoading,
  reset,
} = keyringSlice.actions;

export default keyringSlice.reducer;

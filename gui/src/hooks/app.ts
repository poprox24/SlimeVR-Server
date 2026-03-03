import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
} from 'react';
import {
  DataFeedMessage,
  DataFeedUpdateT,
  ResetResponseT,
  RpcMessage,
  StartDataFeedT,
  TrackerStatus,
} from 'solarxr-protocol';
import { handleResetSounds, trackerErrorSound, restartAndPlay } from '@/sounds/sounds';
import { useConfig } from './config';
import { useBonesDataFeedConfig, useDataFeedConfig } from './datafeed-config';
import { useWebsocketAPI } from './websocket-api';
import { useAtomValue, useSetAtom } from 'jotai';
import { bonesAtom, datafeedAtom, devicesAtom } from '@/store/app-store';
import { getSentryOrCompute, updateSentryContext } from '@/utils/sentry';
import { fetchCurrentFirmwareRelease, FirmwareRelease } from './firmware-update';
import { DEFAULT_LOCALE, LangContext } from '@/i18n/config';

export interface AppContext {
  currentFirmwareRelease: FirmwareRelease | null;
}

export function useProvideAppContext(): AppContext {
  const { useRPCPacket, sendDataFeedPacket, useDataFeedPacket, isConnected } =
    useWebsocketAPI();
  const { changeLocales } = useContext(LangContext);
  const { config } = useConfig();
  const { dataFeedConfig } = useDataFeedConfig();
  const bonesDataFeedConfig = useBonesDataFeedConfig();
  const setDatafeed = useSetAtom(datafeedAtom);
  const setBones = useSetAtom(bonesAtom);
  const devices = useAtomValue(devicesAtom);
  const prevTrackerStatusesRef = useRef<Map<string, number>>(new Map());

  const [currentFirmwareRelease, setCurrentFirmwareRelease] =
    useState<FirmwareRelease | null>(null);

  useEffect(() => {
    if (isConnected) {
      const startDataFeed = new StartDataFeedT();
      startDataFeed.dataFeeds = [dataFeedConfig, bonesDataFeedConfig];
      sendDataFeedPacket(DataFeedMessage.StartDataFeed, startDataFeed);
    }
  }, [isConnected]);

  useDataFeedPacket(DataFeedMessage.DataFeedUpdate, (packet: DataFeedUpdateT) => {
    if (packet.index === 0) {
      setDatafeed(packet);
    } else if (packet.index === 1) {
      setBones(packet.bones);
    }
  });

  useEffect(() => {
    updateSentryContext(devices);
    if (!config?.feedbackSound) return;
    for (const device of devices) {
      for (const tracker of device.trackers) {
        const key = `${device.id?.id}-${tracker.trackerId?.trackerNum}`;
        const prev = prevTrackerStatusesRef.current.get(key) ?? -1;
        const curr = tracker.status ?? -1;
        if (curr === TrackerStatus.ERROR && prev !== TrackerStatus.ERROR) {
          restartAndPlay(trackerErrorSound, config.feedbackSoundVolume ?? 1);
        }
        prevTrackerStatusesRef.current.set(key, curr);
      }
    }
  }, [devices]);

  useRPCPacket(RpcMessage.ResetResponse, (resetResponse: ResetResponseT) => {
    if (!config?.feedbackSound) return;
    handleResetSounds(config?.feedbackSoundVolume ?? 1, resetResponse);
  });

  useEffect(() => {
    if (!config) return;

    const interval = setInterval(() => {
      fetchCurrentFirmwareRelease(config.uuid).then(setCurrentFirmwareRelease);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [config?.uuid]);

  useLayoutEffect(() => {
    changeLocales([config?.lang || DEFAULT_LOCALE]);
  }, []);

  useLayoutEffect(() => {
    if (!config) return;
    if (config.errorTracking !== undefined) {
      console.log('change');
      // Alows for sentry to refresh if user change the setting once the gui
      // is initialized
      getSentryOrCompute(config.errorTracking ?? false, config.uuid);
    }
  }, [config]);

  return {
    currentFirmwareRelease,
  };
}

export const AppContextC = createContext<AppContext>(undefined as any);

export function useAppContext() {
  const context = useContext<AppContext>(AppContextC);
  if (!context) {
    throw new Error('useAppContext must be within a AppContext Provider');
  }
  return context;
}

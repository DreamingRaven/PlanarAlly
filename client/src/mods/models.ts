import type { Component } from "vue";

import type { DataBlock } from "../game/dataBlock/db";
import type { DBR, DataBlockSerializer, DbRepr } from "../game/dataBlock/models";
import { type LocalId } from "../game/id";
import type { IShape } from "../game/interfaces/shape";
import type { SYSTEMS_STATE, System } from "../game/systems";
import type { Tracker } from "../game/systems/trackers/models";

export interface Mod {
    init?: () => Promise<void>;
    initGame?: (data: ModLoad) => Promise<void>;
    loadLocation?: () => Promise<void>;

    preTrackerUpdate?: (id: LocalId, tracker: Tracker, delta: Partial<Tracker>) => Partial<Tracker>;
}

export interface ModLoad {
    systems: Record<string, System>;
    systemsState: typeof SYSTEMS_STATE;

    ui: {
        shape: {
            registerTab: (component: Component, name: string, filter: (shape: LocalId) => boolean) => void;
        };
    };

    getShape: (shape: LocalId) => IShape | undefined;

    getOrLoadDataBlock: <D extends DBR, S extends DBR>(
        repr: DbRepr,
        serializer: DataBlockSerializer<D, S>,
        defaultData?: () => D,
    ) => Promise<DataBlock<D, S> | undefined>;
    loadDataBlock: <D extends DBR, S extends DBR>(
        repr: DbRepr,
        serializer: DataBlockSerializer<D, S>,
        defaultData?: () => D,
    ) => Promise<DataBlock<D, S> | undefined>;
    createDataBlock: <D extends DBR, S extends DBR>(
        repr: DbRepr,
        data: D,
        serializer: DataBlockSerializer<D, S>,
    ) => Promise<DataBlock<D, S>>;
    getDataBlock: <D extends DBR, S extends DBR>(repr: DbRepr) => DataBlock<D, S> | undefined;
}

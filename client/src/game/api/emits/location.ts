import type { ApiSpawnInfo, LocationClone, LocationOptionsSet, LocationRename } from "../../../apiTypes";
import type { ServerLocationOptions } from "../../systems/settings/location/models";
import { wrapSocket } from "../helpers";
import { socket } from "../socket";

export const sendLocationOrder = wrapSocket<number[]>("Locations.Order.Set");
export const sendLocationChange = wrapSocket<{
    location: number;
    users: string[];
    position?: { x: number; y: number };
}>("Location.Change");
export const sendNewLocation = wrapSocket<string>("Location.New");
export const sendLocationRename = wrapSocket<LocationRename>("Location.Rename");
export const sendLocationRemove = wrapSocket<number>("Location.Delete");
export const sendLocationArchive = wrapSocket<number>("Location.Archive");
export const sendLocationUnarchive = wrapSocket<number>("Location.Unarchive");
export const sendLocationClone = wrapSocket<LocationClone>("Location.Clone");

export async function requestSpawnInfo(location: number): Promise<ApiSpawnInfo[]> {
    return new Promise((resolve: (value: ApiSpawnInfo[]) => void) => {
        socket.emit("Location.Spawn.Info.Get", location, resolve);
    });
}

export function sendLocationOption<T extends keyof ServerLocationOptions>(
    key: T,
    value: ServerLocationOptions[T] | undefined,
    location: number | undefined,
): void {
    const data: LocationOptionsSet = { options: { [key]: value ?? null }, location };
    socket.emit("Location.Options.Set", data);
}

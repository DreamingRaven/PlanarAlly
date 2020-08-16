import { InvalidationMode, SyncMode } from "@/core/comm/types";
import { uuidv4 } from "@/core/utils";
import {
    ServerAsset,
    ServerAura,
    ServerCircle,
    ServerCircularToken,
    ServerLine,
    ServerPolygon,
    ServerRect,
    ServerShape,
    ServerText,
} from "@/game/comm/types/shapes";
import { GlobalPoint, Vector } from "@/game/geom";
import { layerManager } from "@/game/layers/manager";
import { Asset } from "@/game/shapes/asset";
import { Circle } from "@/game/shapes/circle";
import { CircularToken } from "@/game/shapes/circulartoken";
import { Line } from "@/game/shapes/line";
import { Rect } from "@/game/shapes/rect";
import { Shape } from "@/game/shapes/shape";
import { Text } from "@/game/shapes/text";
import { socket } from "../api/socket";
import { EventBus } from "../event-bus";
import { floorStore, getFloorId } from "../layers/store";
import { gameStore } from "../store";
import { Polygon } from "./polygon";
import { addGroupMember } from "./group";

export function createShapeFromDict(shape: ServerShape): Shape | undefined {
    let sh: Shape;

    // A fromJSON and toJSON on Shape would be cleaner but ts does not allow for static abstracts so yeah.

    // Shape Type specifics

    const refPoint = new GlobalPoint(shape.x, shape.y);
    if (shape.type_ === "rect") {
        const rect = <ServerRect>shape;
        sh = new Rect(refPoint, rect.width, rect.height, rect.fill_colour, rect.stroke_colour, rect.uuid);
    } else if (shape.type_ === "circle") {
        const circ = <ServerCircle>shape;
        sh = new Circle(refPoint, circ.radius, circ.fill_colour, circ.stroke_colour, circ.uuid);
    } else if (shape.type_ === "circulartoken") {
        const token = <ServerCircularToken>shape;
        sh = new CircularToken(
            refPoint,
            token.radius,
            token.text,
            token.font,
            token.fill_colour,
            token.stroke_colour,
            token.uuid,
        );
    } else if (shape.type_ === "line") {
        const line = <ServerLine>shape;
        sh = new Line(refPoint, new GlobalPoint(line.x2, line.y2), line.line_width, line.stroke_colour, line.uuid);
    } else if (shape.type_ === "polygon") {
        const polygon = <ServerPolygon>shape;
        sh = new Polygon(
            refPoint,
            polygon.vertices.map(v => GlobalPoint.fromArray(v)),
            polygon.fill_colour,
            polygon.stroke_colour,
            polygon.line_width,
            polygon.open_polygon,
            polygon.uuid,
        );
    } else if (shape.type_ === "text") {
        const text = <ServerText>shape;
        sh = new Text(refPoint, text.text, text.font, text.fill_colour, text.stroke_colour, text.uuid);
    } else if (shape.type_ === "assetrect") {
        const asset = <ServerAsset>shape;
        const img = new Image(asset.width, asset.height);
        if (asset.src.startsWith("http")) img.src = new URL(asset.src).pathname;
        else img.src = asset.src;
        sh = new Asset(img, refPoint, asset.width, asset.height, asset.uuid);
        img.onload = () => {
            layerManager.getLayer(layerManager.getFloor(getFloorId(shape.floor))!, shape.layer)!.invalidate(true);
        };
    } else {
        return undefined;
    }
    sh.fromDict(shape);
    return sh;
}

export function copyShapes(): void {
    const layer = floorStore.currentLayer;
    if (!layer) return;
    if (!layer.hasSelection()) return;
    const clipboard: ServerShape[] = [];
    for (const shape of layer.getSelection()) {
        if (!shape.ownedBy({ editAccess: true })) continue;
        clipboard.push(shape.asDict());
    }
    gameStore.setClipboard(clipboard);
    gameStore.setClipboardPosition(gameStore.screenCenter);
}

export function pasteShapes(targetLayer?: string): readonly Shape[] {
    const layer = layerManager.getLayer(floorStore.currentFloor, targetLayer);
    if (!layer) return [];
    if (!gameStore.clipboard) return [];
    layer.setSelection();
    let offset = gameStore.screenCenter.subtract(gameStore.clipboardPosition);
    gameStore.setClipboardPosition(gameStore.screenCenter);
    // Check against 200 as that is the squared length of a vector with size 10, 10
    if (offset.squaredLength() < 200) {
        offset = new Vector(10, 10);
    }
    for (const clip of gameStore.clipboard) {
        clip.x += offset.x;
        clip.y += offset.y;
        const ogUuid = clip.uuid;
        clip.uuid = uuidv4();
        // Trackers
        const oldTrackers = clip.trackers;
        clip.trackers = [];
        for (const tracker of oldTrackers) {
            const newTracker: Tracker = {
                ...tracker,
                uuid: uuidv4(),
            };
            clip.trackers.push(newTracker);
        }
        // Auras
        const oldAuras = clip.auras;
        clip.auras = [];
        for (const aura of oldAuras) {
            const newAura: ServerAura = {
                ...aura,
                uuid: uuidv4(),
            };
            clip.auras.push(newAura);
        }
        // Badge
        const options = clip.options ? new Map(JSON.parse(clip.options)) : new Map();
        let groupLeader: Shape | undefined;
        if (options.has("groupId")) {
            groupLeader = layerManager.UUIDMap.get(<string>options.get("groupId"));
        } else {
            groupLeader = layerManager.UUIDMap.get(ogUuid)!;
        }
        if (groupLeader === undefined) console.error("Missing group leader on paste");
        else {
            if (!groupLeader.options.has("groupInfo")) groupLeader.options.set("groupInfo", []);
            const groupMembers = groupLeader.getGroupMembers();
            clip.badge = groupMembers.reduce((acc: number, sh: Shape) => Math.max(acc, sh.badge ?? 1), 0) + 1;
            options.set("groupId", groupLeader.uuid);
            clip.options = JSON.stringify([...options]);
            addGroupMember({ leader: groupLeader.uuid, member: clip.uuid, sync: true });
        }
        // Finalize
        const shape = createShapeFromDict(clip);
        if (shape === undefined) continue;
        layer.addShape(shape, SyncMode.FULL_SYNC, InvalidationMode.WITH_LIGHT);
        layer.pushSelection(shape);
    }
    layer.invalidate(false);
    return layer.getSelection();
}

// todo: refactor with removeShape in api/events/shape
export function deleteShapes(): void {
    if (floorStore.currentLayer === undefined) {
        console.log("No active layer selected for delete operation");
        return;
    }
    const l = floorStore.currentLayer!;
    for (let i = l.getSelection().length - 1; i >= 0; i--) {
        const sel = l.getSelection()[i];
        if (!sel.ownedBy({ editAccess: true })) continue;
        if (l.removeShape(sel, SyncMode.FULL_SYNC)) EventBus.$emit("SelectionInfo.Shapes.Set", []);
    }
    l.setSelection();
}

export function cutShapes(): void {
    copyShapes();
    deleteShapes();
}

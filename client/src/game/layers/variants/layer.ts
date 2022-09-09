import { toRaw } from "vue";

import { InvalidationMode, SyncMode, UI_SYNC } from "../../../core/models/types";
import { debugLayers } from "../../../localStorageHelpers";
import { getGameState } from "../../../store/_game";
import { activeShapeStore } from "../../../store/activeShape";
import { gameStore } from "../../../store/game";
import { sendRemoveShapes, sendShapeAdd, sendShapeOrder } from "../../api/emits/shape/core";
import { removeGroupMember } from "../../groups";
import { dropId, getGlobalId } from "../../id";
import type { LocalId } from "../../id";
import type { ILayer } from "../../interfaces/layer";
import type { IShape } from "../../interfaces/shape";
import { LayerName } from "../../models/floor";
import type { FloorId } from "../../models/floor";
import type { ServerShape } from "../../models/shapes";
import { addOperation } from "../../operations/undo";
import { drawAuras } from "../../rendering/auras";
import { createShapeFromDict } from "../../shapes/create";
import { accessSystem } from "../../systems/access";
import { floorSystem } from "../../systems/floors";
import { floorState } from "../../systems/floors/state";
import { propertiesSystem } from "../../systems/properties";
import { getProperties } from "../../systems/properties/state";
import { selectedSystem } from "../../systems/selected";
import { locationSettingsSystem } from "../../systems/settings/location";
import { locationSettingsState } from "../../systems/settings/location/state";
import { playerSettingsState } from "../../systems/settings/players/state";
import { initiativeStore } from "../../ui/initiative/state";
import { TriangulationTarget, VisibilityMode, visionState } from "../../vision/state";
import { setCanvasDimensions } from "../canvas";
import { compositeState } from "../state";

export class Layer implements ILayer {
    ctx: CanvasRenderingContext2D;

    // When set to false, the layer will be redrawn on the next tick
    protected valid = true;

    playerEditable = false;
    selectable = false;

    isVisionLayer = false;

    // The collection of shapes that this layer contains.
    // These are ordered on a depth basis.
    protected shapes: IShape[] = [];

    points: Map<string, Set<LocalId>> = new Map();

    // Extra selection highlighting settings
    protected selectionColor = "#CC0000";
    protected selectionWidth = 2;

    protected postDrawCallbacks: (() => void)[] = [];

    constructor(
        public canvas: HTMLCanvasElement,
        public name: LayerName,
        public floor: FloorId,
        protected index: number,
    ) {
        this.ctx = canvas.getContext("2d")!;
    }

    invalidate(skipLightUpdate: boolean): void {
        if (debugLayers) {
            console.groupCollapsed(`🗑 [${this.floor}] ${this.name}`);
            console.trace();
            console.groupEnd();
        }
        this.valid = false;
        if (!skipLightUpdate) {
            floorSystem.invalidateLight(this.floor);
        }
    }

    get isActiveLayer(): boolean {
        return toRaw(floorState.currentLayer.value) === this;
    }

    get width(): number {
        return this.canvas.width / playerSettingsState.devicePixelRatio.value;
    }

    get height(): number {
        return this.canvas.height / playerSettingsState.devicePixelRatio.value;
    }

    resize(width: number, height: number): void {
        setCanvasDimensions(this.canvas, width, height);
    }

    // SHAPES

    /**
     * Returns the number of shapes on this layer
     */
    size(options: { skipUiHelpers?: boolean; includeComposites: boolean }): number {
        return this.getShapes(options).length;
    }

    addShape(shape: IShape, sync: SyncMode, invalidate: InvalidationMode): void {
        shape.setLayer(this.floor, this.name);

        this.shapes.push(shape);

        const props = getProperties(shape.id);
        if (props === undefined) return console.error("Missing shape properties");

        propertiesSystem.setBlocksVision(shape.id, props.blocksVision, UI_SYNC, invalidate !== InvalidationMode.NO);
        propertiesSystem.setBlocksMovement(shape.id, props.blocksMovement, UI_SYNC, invalidate !== InvalidationMode.NO);

        shape.invalidatePoints();
        if (shape.isSnappable) {
            for (const point of shape.points) {
                const strp = JSON.stringify(point);
                this.points.set(strp, (this.points.get(strp) || new Set()).add(shape.id));
            }
        }

        if (accessSystem.hasAccessTo(shape.id, false, { vision: true }) && props.isToken)
            accessSystem.addOwnedToken(shape.id);

        if (sync !== SyncMode.NO_SYNC && !shape.preventSync) {
            sendShapeAdd({ shape: shape.asDict(), temporary: sync === SyncMode.TEMP_SYNC });
        }
        if (invalidate) this.invalidate(invalidate !== InvalidationMode.WITH_LIGHT);

        if (
            this.isActiveLayer &&
            activeShapeStore.state.id === undefined &&
            activeShapeStore.state.lastUuid === shape.id
        ) {
            selectedSystem.push(shape.id);
        }

        if (sync === SyncMode.FULL_SYNC) {
            addOperation({ type: "shapeadd", shapes: [shape.asDict()] });
        }
        shape.onLayerAdd();
    }

    // UI helpers are objects that are created for UI reaons but that are not pertinent to the actual state
    // They are often not desired unless in specific circumstances
    getShapes(options: { skipUiHelpers?: boolean; includeComposites: boolean }): readonly IShape[] {
        const skipUiHelpers = options.skipUiHelpers ?? true;
        let shapes: readonly IShape[] = skipUiHelpers
            ? this.shapes.filter((s) => !(s.options.UiHelper ?? false))
            : this.shapes;
        if (options.includeComposites) {
            shapes = compositeState.addAllCompositeShapes(shapes);
        }
        return shapes;
    }

    pushShapes(...shapes: IShape[]): void {
        this.shapes.push(...shapes);
    }

    setShapes(...shapes: IShape[]): void {
        this.shapes = shapes;
    }

    setServerShapes(shapes: ServerShape[]): void {
        if (this.isActiveLayer) selectedSystem.clear(); // TODO: Fix keeping selection on those items that are not moved.
        // We need to ensure composites are added after all their variants have been added
        const composites = [];
        for (const serverShape of shapes) {
            if (serverShape.type_ === "togglecomposite") {
                composites.push(serverShape);
            } else {
                this.setServerShape(serverShape);
            }
        }
        for (const composite of composites) this.setServerShape(composite);
    }

    private setServerShape(serverShape: ServerShape): void {
        const shape = createShapeFromDict(serverShape);
        if (shape === undefined) {
            console.log(`Shape with unknown type ${serverShape.type_} could not be added`);
            return;
        }
        let invalidate = InvalidationMode.NO;
        if (visionState.state.mode === VisibilityMode.TRIANGLE_ITERATIVE) {
            invalidate = InvalidationMode.WITH_LIGHT;
        }
        this.addShape(shape, SyncMode.NO_SYNC, invalidate);
    }

    removeShape(shape: IShape, options: { sync: SyncMode; recalculate: boolean; dropShapeId: boolean }): boolean {
        const idx = this.shapes.indexOf(shape);
        if (idx < 0) {
            console.error("attempted to remove shape not in layer.");
            return false;
        }
        if (locationSettingsState.raw.spawnLocations.value.includes(shape.id)) {
            locationSettingsSystem.setSpawnLocations(
                locationSettingsState.raw.spawnLocations.value.filter((s) => s !== shape.id),
                locationSettingsState.raw.activeLocation,
                true,
            );
        }
        this.shapes.splice(idx, 1);

        if (shape.groupId !== undefined) {
            removeGroupMember(shape.groupId, shape.id, false);
        }

        if (options.sync !== SyncMode.NO_SYNC && !shape.preventSync)
            sendRemoveShapes({ uuids: [getGlobalId(shape.id)], temporary: options.sync === SyncMode.TEMP_SYNC });

        visionState.removeBlocker(TriangulationTarget.VISION, this.floor, shape, options.recalculate);
        visionState.removeBlocker(TriangulationTarget.MOVEMENT, this.floor, shape, options.recalculate);
        visionState.removeVisionSources(this.floor, shape.id);

        accessSystem.removeOwnedToken(shape.id);

        // Needs to be retrieved before dropping the ID
        const triggersVisionRecalc = shape.triggersVisionRecalc;

        if (options.dropShapeId) dropId(shape.id);
        gameStore.removeMarker(shape.id, true);

        for (const point of shape.points) {
            const strp = JSON.stringify(point);
            const val = this.points.get(strp);
            if (val === undefined || val.size === 1) this.points.delete(strp);
            else val.delete(shape.id);
        }

        if (this.isActiveLayer) selectedSystem.remove(shape.id);

        if (options.sync === SyncMode.FULL_SYNC) initiativeStore.removeInitiative(shape.id, false);
        this.invalidate(!triggersVisionRecalc);
        return true;
    }

    // TODO: This does not take into account shapes that the server does not know about
    moveShapeOrder(shape: IShape, destinationIndex: number, sync: SyncMode): void {
        const oldIdx = this.shapes.indexOf(shape);
        if (oldIdx === destinationIndex) return;
        this.shapes.splice(oldIdx, 1);
        this.shapes.splice(destinationIndex, 0, shape);
        if (sync !== SyncMode.NO_SYNC && !shape.preventSync)
            sendShapeOrder({
                uuid: getGlobalId(shape.id),
                index: destinationIndex,
                temporary: sync === SyncMode.TEMP_SYNC,
            });
        this.invalidate(true);
    }

    // DRAW

    hide(): void {
        this.canvas.style.display = "none";
    }

    show(): void {
        this.canvas.style.removeProperty("display");
    }

    clear(): void {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    draw(doClear = true): void {
        if (!this.valid) {
            if (debugLayers) {
                console.groupCollapsed(`🖌 [${this.floor}] ${this.name}`);
                console.trace();
                console.groupEnd();
            }
            const ctx = this.ctx;
            const ogOP = ctx.globalCompositeOperation;

            if (doClear) this.clear();

            const gameState = getGameState();

            // We iterate twice over all shapes
            // First to draw the auras and a second time to draw the shapes themselves
            // Otherwise auras from one shape could overlap another shape.

            const currentLayer = toRaw(floorState.currentLayer.value);
            // To optimize things slightly, we keep track of the shapes that passed the first round
            const visibleShapes: IShape[] = [];

            // Aura draw loop
            for (const shape of this.shapes) {
                if (shape.options.skipDraw ?? false) continue;
                if (!shape.visibleInCanvas({ w: this.width, h: this.height }, { includeAuras: true })) continue;
                if (this.name === LayerName.Lighting && currentLayer !== this) continue;

                drawAuras(shape, ctx);

                if (getProperties(shape.id)!.isInvisible && !accessSystem.hasAccessTo(shape.id, true, { vision: true }))
                    continue;
                if (shape.labels.length === 0 && gameState.filterNoLabel) continue;
                if (
                    shape.labels.length &&
                    gameState.labelFilters.length &&
                    !shape.labels.some((l) => gameState.labelFilters.includes(l.uuid))
                ) {
                    continue;
                }

                visibleShapes.push(shape);
            }

            // Normal shape draw loop
            for (const shape of visibleShapes) {
                shape.draw(ctx);
            }

            if (this.isActiveLayer && selectedSystem.hasSelection) {
                ctx.fillStyle = this.selectionColor;
                ctx.strokeStyle = this.selectionColor;
                ctx.lineWidth = this.selectionWidth;
                for (const shape of selectedSystem.get({ includeComposites: false })) {
                    shape.drawSelection(ctx);
                }
            }

            // If this is the last layer of the floor below, render some shadow
            if (floorState.raw.floorIndex > 0) {
                const lowerFloor = floorState.raw.floors[floorState.raw.floorIndex - 1];
                if (lowerFloor.id === this.floor) {
                    const layers = floorSystem.getLayers(lowerFloor);
                    if (layers.at(-1)?.name === this.name) {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
                        ctx.fillRect(0, 0, this.width, this.height);
                    }
                }
            }

            ctx.globalCompositeOperation = ogOP;
            this.valid = true;
            this.resolveCallbacks();
        }
    }

    // CALLBACKS

    waitValid(): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.postDrawCallbacks.push(resolve);
        });
    }

    private resolveCallbacks(): void {
        for (const cb of this.postDrawCallbacks) cb();
        this.postDrawCallbacks = [];
    }
}

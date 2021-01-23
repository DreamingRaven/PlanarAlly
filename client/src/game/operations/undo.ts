import { EventBus } from "../event-bus";
import { GlobalPoint, Vector } from "../geom";
import { layerManager } from "../layers/manager";
import { Operation, ShapeMovementOperation, ShapeRotationOperation } from "./model";
import { moveShapes } from "./movement";
import { rotateShapes } from "./rotation";

const undoStack: Operation[] = [];
let redoStack: Operation[] = [];
let operationInProgress = false;

export function addOperation(operation: Operation): void {
    console.log(operationInProgress, operation);
    if (operationInProgress) return;
    undoStack.push(operation);
    redoStack = [];
}

export function undoOperation(): void {
    handleOperation("undo");
}

export function redoOperation(): void {
    handleOperation("redo");
}

function handleOperation(direction: "undo" | "redo"): void {
    operationInProgress = true;
    const op = direction === "undo" ? undoStack.pop() : redoStack.pop();
    if (op !== undefined) {
        if (direction === "undo") redoStack.push(op);
        else undoStack.push(op);

        if (op.type === "movement") {
            handleMovement(op.shapes, direction);
        } else if (op.type === "rotation") {
            handleRotation(op.shapes, op.center, direction);
        }
    }
    operationInProgress = false;
}

function handleMovement(shapes: ShapeMovementOperation[], direction: "undo" | "redo"): void {
    const fullShapes = shapes.map((s) => layerManager.UUIDMap.get(s.uuid)!);
    let delta = Vector.fromPoints(GlobalPoint.fromArray(shapes[0].to), GlobalPoint.fromArray(shapes[0].from));
    if (direction === "redo") delta = delta.reverse();
    moveShapes(fullShapes, delta, true);
}

function handleRotation(shapes: ShapeRotationOperation[], center: GlobalPoint, direction: "undo" | "redo"): void {
    const fullShapes = shapes.map((s) => layerManager.UUIDMap.get(s.uuid)!);
    let angle = shapes[0].from - shapes[0].to;
    if (direction === "redo") angle *= -1;
    rotateShapes(fullShapes, angle, center, true);
    EventBus.$emit("Select.RotationHelper.Reset");
}

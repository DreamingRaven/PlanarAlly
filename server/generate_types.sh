#!/usr/bin/env bash

PYTHONPATH=`pwd` pydantic2ts --module src.api.models --json2ts-cmd ../client/node_modules/.bin/json2ts --output ../client/src/apiTypes.ts
sed -i 's/"GlobalId"/GlobalId/g' ../client/src/apiTypes.ts
sed -i 's/"TrackerId"/TrackerId/g' ../client/src/apiTypes.ts
sed -i 's/"AuraId"/AuraId/g' ../client/src/apiTypes.ts
sed -i 's/"ClientId"/ClientId/g' ../client/src/apiTypes.ts
sed -i 's/"PlayerId"/PlayerId/g' ../client/src/apiTypes.ts
sed -i 's/"CharacterId"/CharacterId/g' ../client/src/apiTypes.ts
sed -i 's/"LayerName"/LayerName/g' ../client/src/apiTypes.ts
sed -i 's/"AssetId"/AssetId/g' ../client/src/apiTypes.ts
sed -i '1s/^/import type { AssetId } from ".\/assetManager\/models";\nimport type { GlobalId } from ".\/game\/id";\nimport type { LayerName } from ".\/game\/models\/floor";\nimport type { AuraId } from ".\/game\/systems\/auras\/models";\nimport type { CharacterId } from ".\/game\/systems\/characters\/models";\nimport type { ClientId } from ".\/game\/systems\/client\/models";\nimport type { PlayerId } from ".\/game\/systems\/players\/models";\nimport type { TrackerId } from ".\/game\/systems\/trackers\/models";\n\nexport type ApiShape = ApiAssetRectShape | ApiRectShape | ApiCircleShape | ApiCircularTokenShape | ApiPolygonShape | ApiTextShape | ApiLineShape | ApiToggleCompositeShape\nexport type ApiDataBlock = ApiRoomDataBlock | ApiShapeDataBlock | ApiUserDataBlock\n\n/' ../client/src/apiTypes.ts

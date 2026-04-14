/** Mark a material (PBR or Standard) as dirty — its UBO will be re-uploaded on the next frame.
 *  Call after mutating any material property (alpha, emissiveColor, anisotropy.intensity, etc.). */
export function markMaterialDirty(material: { _uboDirty?: boolean }): void {
    material._uboDirty = true;
}

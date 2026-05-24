// PostFX that swaps a source color (the UI blue used as the card background)
// for a target color (the active player's color). Match strength falls off
// smoothly within `uTolerance` so anti-aliased rim pixels recolor cleanly
// instead of leaving a halo of the old blue. White numbers/sparkles and the
// mouse/cat art are far from the source color and so pass through untouched.
const FRAG_SHADER = `
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform vec3 uSourceColor;
uniform vec3 uTargetColor;
uniform float uAmount;
uniform float uTolerance;

varying vec2 outTexCoord;

void main() {
    vec4 src = texture2D(uMainSampler, outTexCoord);

    // Unpremultiply so anti-aliased edge pixels (whose stored RGB is scaled
    // by alpha) still compare against the source color correctly.
    vec3 unpre = src.a > 0.0001 ? src.rgb / src.a : src.rgb;

    float d = distance(unpre, uSourceColor);
    float match = 1.0 - smoothstep(0.0, uTolerance, d);
    vec3 result = mix(unpre, uTargetColor, match * uAmount);

    gl_FragColor = vec4(result * src.a, src.a);
}
`;

export class ColorReplacePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
        super({
            game,
            name: 'ColorReplace',
            fragShader: FRAG_SHADER,
        });
        this.sourceColor = [0.0, 0.65, 0.93];
        this.targetColor = [1.0, 1.0, 1.0];
        this.amount = 0.0;
        this.tolerance = 0.22;
    }

    onDraw(renderTarget) {
        this.set3f('uSourceColor', this.sourceColor[0], this.sourceColor[1], this.sourceColor[2]);
        this.set3f('uTargetColor', this.targetColor[0], this.targetColor[1], this.targetColor[2]);
        this.set1f('uAmount', this.amount);
        this.set1f('uTolerance', this.tolerance);
        this.bindAndDraw(renderTarget);
    }

    setSourceHex(hex) {
        const c = Phaser.Display.Color.IntegerToColor(hex);
        this.sourceColor = [c.red / 255, c.green / 255, c.blue / 255];
        return this;
    }

    setTargetHex(hex) {
        const c = Phaser.Display.Color.IntegerToColor(hex);
        this.targetColor = [c.red / 255, c.green / 255, c.blue / 255];
        return this;
    }

    setAmount(v) {
        this.amount = v;
        return this;
    }
}

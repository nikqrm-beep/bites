import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

class MindARController {

    constructor(container, threePlayer, debug = false) {
        this.container = container;
        this.threePlayer = threePlayer;
        this.debug = debug;
        this.isMobile = /Android|iPhone|iPod|iPad/i.test(navigator.userAgent);

        this.imageTargetSrc = 'assets/marker/targets.mind';

        this.mindar = null;
        this.anchors = [];
        this.started = false;

        this.listeners = {
            start: [],
            found: [],
            lost: [],
            update: [],
        };

        this.clickHandlerBound = false;
    }

    addListener(type, callback) { this.listeners[type].push(callback); }

    dispatch(type, event) {
        for (const listener of this.listeners[type]) {
            listener(event);
        }
    }

    async start() {

        if (this.started) return;

        // Limpia restos de un intento anterior (p.ej. un <video> huérfano).
        if (this.mindar) { this.stop(); }
        this.container.replaceChildren();

        const player = this.threePlayer;
        const imageTargets = player?.imageTargets;

        if (!imageTargets || !imageTargets.length) {
            throw new Error('player.imageTargets está vacío. Asegurate de que los scripts de la escena se ejecutaron.');
        }

        this.mindar = new MindARThree({
            container: this.container,
            imageTargetSrc: this.imageTargetSrc,
            filterMinCF: 0.001,
            filterBeta: 1000,
            warmupTolerance: 5,
            missTolerance: 5,
            uiLoading: 'no',
            uiScanning: 'no',
            uiError: 'yes',
        });

        const { scene, camera, renderer } = this.mindar;

        // Anchora el contenido AR de cada ImageTarget sobre el target.
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);

        for (let i = 0; i < imageTargets.length; i++) {
            const it = imageTargets[i];
            const anchor = this.mindar.addAnchor(i);

            const content = it.arContent;
            if (content) {
                content.scale.setScalar(0.6);
                content.rotation.set(THREE.MathUtils.degToRad(90), 0, 0);

                // --- LÓGICA DE LOS BOTONES 3D ---
                const btnAmarillo = content.getObjectByName('BotonAmarillo');
                const btnVerde = content.getObjectByName('BotonVerde');
                const btnRojo = content.getObjectByName('BotonRojo');

                const imgAmarillo = content.getObjectByName('Img_Amarillo');
                const imgVerde = content.getObjectByName('Img_Verde');
                const imgRojo = content.getObjectByName('Img_Rojo');
                const imgGrande = content.getObjectByName('Img_Grande');
                const imgChiquitos = content.getObjectByName('Img_Chiquitos');

                // Asegurar estado inicial (solo amarillo visible si existen las imágenes)
                if (imgGrande) imgGrande.visible = true;
                if (imgChiquitos) imgChiquitos.visible = false;
                if (imgAmarillo) imgAmarillo.visible = false;
                if (imgVerde) imgVerde.visible = false;
                if (imgRojo) imgRojo.visible = false;

                if (btnAmarillo) {
                    // Guardamos la función de audio que ya traía el botón desde Three.js (si la tiene)
                    const audioOriginal = btnAmarillo.onClick;

                    btnAmarillo.onClick = () => {
                        // 1. Cambiar las imágenes
                        if (imgAmarillo) imgAmarillo.visible = true;
                        if (imgVerde) imgVerde.visible = false;
                        if (imgRojo) imgRojo.visible = false;
                        if (imgGrande) imgGrande.visible = false;
                        if (imgChiquitos) imgChiquitos.visible = true;

                        // 2. Ejecutar el sonido original que tenía el botón
                        if (audioOriginal && typeof audioOriginal === 'function') {
                            audioOriginal();
                        }
                    };
                }

                if (btnVerde) {
                    const audioOriginal = btnVerde.onClick;

                    btnVerde.onClick = () => {
                        if (imgAmarillo) imgAmarillo.visible = false;
                        if (imgVerde) imgVerde.visible = true;
                        if (imgRojo) imgRojo.visible = false;
                        if (imgGrande) imgGrande.visible = false;
                        if (imgChiquitos) imgChiquitos.visible = true;

                        if (audioOriginal && typeof audioOriginal === 'function') {
                            audioOriginal();
                        }
                    };
                }

                if (btnRojo) {
                    const audioOriginal = btnRojo.onClick;

                    btnRojo.onClick = () => {
                        if (imgAmarillo) imgAmarillo.visible = false;
                        if (imgVerde) imgVerde.visible = false;
                        if (imgRojo) imgRojo.visible = true;
                        if (imgGrande) imgGrande.visible = false;
                        if (imgChiquitos) imgChiquitos.visible = true;

                        if (audioOriginal && typeof audioOriginal === 'function') {
                            audioOriginal();
                        }
                    };
                }
                // ---------------------------------

                anchor.group.add(content);
            }

            if (this.debug) {
                this.addMarkerDebugHelpers(anchor.group);
            }

            anchor.onTargetFound = () => {
                console.log(`MindARController: target detectado ${i}`);
                if (it.onFound) it.onFound.call(it);
                if (content) content.visible = true;
                this.dispatch('found', it);
            };

            anchor.onTargetLost = () => {
                console.log(`MindARController: target perdido ${i}`);
                if (it.onLost) it.onLost.call(it);
                if (content) content.visible = false;
                this.dispatch('lost', it);
            };

            this.anchors.push(anchor);
        }

        this.copyEnvironment(scene, player);
        this.copyLights(scene, player);
        this.copyRendererSettings(renderer, player);

        // El player sigue corriendo (events update/audio) pero deja de pintar.
        if (player?.setRenderEnabled) player.setRenderEnabled(false);

        this.bindClickEvents();

        try {
            await this.mindar.start();
        } catch (e) {
            this.mindar = null;
            this.started = false;
            const detail = (e && e.message) ? `: ${e.message}` : '. Comprobá que la cámara esté disponible y permitas el acceso';
            throw new Error(`No se pudo iniciar la cámara AR${detail}`);
        }

        renderer.setAnimationLoop(() => {
            this.dispatch('update', {});
            renderer.render(scene, camera);
        });

        this.started = true;
        this.dispatch('start', {});
    }

    stop() {
        if (!this.mindar) return;
        if (this.mindar.renderer?.setAnimationLoop) {
            this.mindar.renderer.setAnimationLoop(null);
        }
        this.mindar.stop();
        this.mindar = null;
        this.started = false;
    }

    switchCamera() {
        this.mindar?.switchCamera();
    }

    copyEnvironment(scene, player) {
        const appScene = player?.scene;
        if (!appScene) return;

        if (appScene.environment) {
            scene.environment = appScene.environment;
        }
        if (appScene.environmentIntensity !== undefined) {
            scene.environmentIntensity = appScene.environmentIntensity;
        }
        if (appScene.environmentRotation) {
            scene.environmentRotation.copy(appScene.environmentRotation);
        }
    }

    copyLights(scene, player) {
        const appScene = player?.scene;
        if (!appScene) return;

        appScene.traverse((obj) => {
            if (obj.isLight && obj !== appScene) {
                scene.add(obj.clone());
            }
        });
    }

    copyRendererSettings(renderer, player) {
        const appRenderer = player?.renderer;
        if (!appRenderer || !renderer) return;

        renderer.toneMapping = appRenderer.toneMapping;
        renderer.toneMappingExposure = appRenderer.toneMappingExposure;
        renderer.shadowMap.enabled = appRenderer.shadowMap?.enabled === true && !this.isMobile;
        renderer.shadowMap.type = appRenderer.shadowMap?.type ?? THREE.PCFShadowMap;
    }

    bindClickEvents() {
        if (this.clickHandlerBound) return;
        this.clickHandlerBound = true;

        if (window.PointerEvent) {
            document.addEventListener('pointerdown', (ev) => this.onArClick(ev));
        } else {
            document.addEventListener('touchstart', (ev) => {
                const touch = ev.changedTouches?.[0];
                if (touch) this.onArClick(touch);
            });
            document.addEventListener('click', (ev) => this.onArClick(ev));
        }
    }

    onArClick(ev) {
        const mindar = this.mindar;
        if (!mindar) return;

        const { scene, camera, renderer } = mindar;
        const canvas = renderer?.domElement;

        const rect = canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((ev.clientX - rect.left) / rect.width) * 2 - 1,
            -((ev.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const hits = raycaster.intersectObjects(scene.children, true);
        for (const hit of hits) {
            let obj = hit.object;
            while (obj) {
                if (obj.onClick && typeof obj.onClick === 'function' && this.objIsActive(obj)) {
                    obj.onClick();
                    return;
                }
                obj = obj.parent;
            }
        }
    }

    objIsActive(obj) {
        if (obj.visible === false) return false;
        let active = true;
        obj.traverseAncestors((ancestor) => {
            if (ancestor.visible === false) active = false;
        });
        return active;
    }

    addMarkerDebugHelpers(root) {
        const planeSize = 0.5;
        const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        root.add(new THREE.Mesh(planeGeometry, planeMaterial));
        root.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeometry),
            new THREE.LineBasicMaterial({ color: 0x00ffff })
        ));
        root.add(new THREE.AxesHelper(0.3));
    }

}

export { MindARController };

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';


document.addEventListener('DOMContentLoaded', () => {
    const start = async () => {

        // ============ MINDAR SETUP ============
        
        const arContainer = document.createElement('div');
        arContainer.id = 'ar-container';
        document.body.appendChild(arContainer);

        const mindarThree = new MindARThree({
            container: arContainer,
            imageTargetSrc: "./assets/targets/targetinvitedpilot.mind",
            maxTrack: 3, // Allow tracking of 3 targets
            filterMinCF: 0.0001, // Lower value for better tracking
            filterBeta: 10,      // Higher value for more smoothing (was 1000, which is too high)
            warmupTolerance: 10, // More tolerance for warmup
            missTolerance: 10    // More tolerance for brief tracking losses
        });
        const {renderer, scene, camera} = mindarThree;

        // Position the AR canvas to fill the screen
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.inset = '0';
        renderer.domElement.style.zIndex = '0';
        
        // Optimize renderer for better performance
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance

        // Add lighting to the scene
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
        scene.add(light);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(0, 1, 1);
        scene.add(directionalLight);

        // Create anchor points for AR tracking
        const anchor = mindarThree.addAnchor(0); // First target (main scenes)
        // Second anchor will be created later when needed (performance optimization)

        // --- SMOOTHING GROUP (to reduce jitter) ---
        // The smoothed group is at scene level, not as child of anchor
        // This allows us to interpolate its world transform independently
        const smoothed = new THREE.Group();
        scene.add(smoothed); // Add to scene, not to anchor

        // --- HUD (screen-fixed arrows) ---
        injectHUDStyles();
        const { hud, prevB, nextB, replayB, label } = createHUD(); // appended to <body>, hidden by default
        hud.hidden = true;
        
        // --- Info button (top right corner) ---
        const { infoB } = createInfoButton();
        
        // --- Info modal ---
        const { infoModal, infoContent, infoCloseBtn } = createInfoModal();

        // --- models list + helpers ---
        const TOTAL = 3; // Total number of AR scenes on first target
        const models = new Array(TOTAL); // Array to store loaded 3D models
        const slotControllers = new Array(TOTAL);  // optional onEnter/onLeave per slot
        let index = 0; // Current active scene index
        let lastActive = -1; // Previously active scene index
        let targetFound = false; // Track if target is currently found
        
        // --- Info text (shared for both targets) ---
        const infoText = "Solar energy producing buildings were identified using 2023 satellite imagery.Estimates of solar energy production and consumption were derived from the Verbruiksgegevens per straat dataset published on the Fluvious Open Data Portal, the data calculated via the Zonnekaart platform (apps.energiesparen.be/zonnekaart), and satellite images. The resulting values are estimates and may differ from actual conditions.";
        
        // --- Second target system (middle target with 3 scenes, last one is guide) ---
        let secondTargetActive = false; // Track if second target is active
        let secondAnchor = null; // Second target anchor (created when first target completes)
        let secondAnchorInitialized = false; // Track if second anchor has been set up
        
        // Second target scenes
        const SECOND_TOTAL = 2; // Total number of scenes on second target
        const secondModels = new Array(SECOND_TOTAL); // Array to store second target models
        const secondSlotControllers = new Array(SECOND_TOTAL); // Controllers for second target slots
        let secondIndex = 0; // Current active scene on second target
        let secondLastActive = -1; // Previously active scene on second target
        let secondTargetFound = false; // Track if second target is currently visible
        
        // --- Third target system ---
        let thirdTargetActive = false; // Track if third target is active
        let thirdAnchor = null; // Third target anchor (created when second target completes)
        let thirdAnchorInitialized = false; // Track if third anchor has been set up
        
        // Third target scenes
        const THIRD_TOTAL = 1; // Total number of scenes on third target
        const thirdModels = new Array(THIRD_TOTAL); // Array to store third target models
        const thirdSlotControllers = new Array(THIRD_TOTAL); // Controllers for third target slots
        let thirdIndex = 0; // Current active scene on third target
        let thirdLastActive = -1; // Previously active scene on third target
        let thirdTargetFound = false; // Track if third target is currently visible
        let thirdSmoothed = null; // Smoothed group for third target
        
        // --- Scene completion tracking ---
        let viewedScenes = new Set(); // Track which scenes have been viewed (from first target)
        let allScenesCompleted = false; // Track if all first target scenes are finished
        let secondTargetPromptShown = false; // Ensure we only trigger the prompt once
        let secondTargetPromptElem = null;
        let secondTargetPromptTimer = null;
        let secondTargetArrow = null;
        let shouldShowSecondTargetArrow = false;
        let secondTargetPromptDelayTimer = null;
        let awaitingSecondTarget = false;
        let firstTargetCurrentlyTracked = false;
        
        // Third target completion tracking
        let secondTargetScenesCompleted = false; // Track if all second target scenes are finished
        let thirdTargetPromptShown = false; // Ensure we only trigger the prompt once
        let thirdTargetPromptElem = null;
        let thirdTargetPromptTimer = null;
        let thirdTargetPromptDelayTimer = null;
        let awaitingThirdTarget = false;

        const loader = new GLTFLoader();

        const countLoaded = () => models.filter(Boolean).length;
        const secondCountLoaded = () => secondModels.filter(Boolean).length;
        const thirdCountLoaded = () => thirdModels.filter(Boolean).length;
        
        function updateLabel() {
        // show current slot number if that slot is loaded; otherwise 0
                label.textContent = `Part 1 - ${models[index] ? index + 1 : 0}/${TOTAL}`;
        }
        
        // Track scene viewing and check for completion
        function markSceneViewed(sceneIndex) {
            // Track all 3 scenes of first target
            if (sceneIndex < 3) {
                viewedScenes.add(sceneIndex);
                console.log(`[Target 1] Scene ${sceneIndex + 1} viewed. Total viewed: ${viewedScenes.size}/3`);
                
                // Check if all 3 scenes are completed
                if (viewedScenes.size >= 3 && !allScenesCompleted) {
                    allScenesCompleted = true;
                    console.log('🎉 All first target scenes completed! Second target will be available.');
                    updateLabel();
                    updateNavigationButtons(); // Enable navigation to second target
                }
            }
        }
        
        function ensureSecondTargetPromptElement() {
            if (secondTargetPromptElem) return secondTargetPromptElem;
            const prompt = document.createElement('div');
            prompt.id = 'second-target-prompt';
            prompt.style.cssText = `
                position: fixed;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                pointer-events: none;
                transition: opacity 0.3s ease;
                opacity: 0;
            `;
            const content = document.createElement('div');
            content.style.cssText = `
                max-width: min(320px, 80vw);
                padding: 24px 28px;
                border-radius: 20px;
                background: rgba(25, 28, 36, 0.9);
                color: #ffffff;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                text-align: center;
                line-height: 1.4;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
                pointer-events: auto;
            `;
            content.innerHTML = `
                <div style="font-size:18px; font-weight:700; margin-bottom:8px;">Move to the other street sign</div>
                <div style="font-size:15px;">Point your camera at the sign of the other street to view the rest of the story.</div>
            `;
            prompt.appendChild(content);
            document.body.appendChild(prompt);
            secondTargetPromptElem = prompt;
            return prompt;
        }
        
        function showSecondTargetPrompt() {
            const prompt = ensureSecondTargetPromptElement();
            prompt.style.display = 'flex';
            requestAnimationFrame(() => { prompt.style.opacity = '1'; });
        }
        
        function hideSecondTargetPrompt() {
            if (!secondTargetPromptElem) return;
            secondTargetPromptElem.style.opacity = '0';
            clearTimeout(secondTargetPromptDelayTimer);
            secondTargetPromptDelayTimer = null;
            clearTimeout(secondTargetPromptTimer);
            secondTargetPromptTimer = setTimeout(() => {
                if (secondTargetPromptElem) {
                    secondTargetPromptElem.style.display = 'none';
                }
            }, 300);
        }
        
        // Third target prompt functions
        function ensureThirdTargetPromptElement() {
            if (thirdTargetPromptElem) return thirdTargetPromptElem;
            const prompt = document.createElement('div');
            prompt.id = 'third-target-prompt';
            prompt.style.cssText = `
                position: fixed;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                pointer-events: none;
                transition: opacity 0.3s ease;
                opacity: 0;
            `;
            const content = document.createElement('div');
            content.style.cssText = `
                max-width: min(320px, 80vw);
                padding: 24px 28px;
                border-radius: 20px;
                background: rgba(25, 28, 36, 0.9);
                color: #ffffff;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                text-align: center;
                line-height: 1.4;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
                pointer-events: auto;
            `;
            content.innerHTML = `
                <div style="font-size:18px; font-weight:700; margin-bottom:8px;">Turn to your left</div>
                <div style="font-size:18px; font-weight:700; margin-bottom:8px;">Stand on the arrow on the ground and aim your camera straight ahead to the building across.</div>
            `;
            prompt.appendChild(content);
            document.body.appendChild(prompt);
            thirdTargetPromptElem = prompt;
            return prompt;
        }
        
        function showThirdTargetPrompt() {
            const prompt = ensureThirdTargetPromptElement();
            prompt.style.display = 'flex';
            requestAnimationFrame(() => { prompt.style.opacity = '1'; });
        }
        
        function hideThirdTargetPrompt() {
            if (!thirdTargetPromptElem) return;
            thirdTargetPromptElem.style.opacity = '0';
            clearTimeout(thirdTargetPromptDelayTimer);
            thirdTargetPromptDelayTimer = null;
            clearTimeout(thirdTargetPromptTimer);
            thirdTargetPromptTimer = setTimeout(() => {
                if (thirdTargetPromptElem) {
                    thirdTargetPromptElem.style.display = 'none';
                }
            }, 300);
        }
        
        function showSecondTargetArrow() {
            shouldShowSecondTargetArrow = true;
            if (secondTargetArrow) {
                secondTargetArrow.visible = true;
            }
        }
        
        function hideSecondTargetArrow() {
            shouldShowSecondTargetArrow = false;
            if (secondTargetArrow) {
                secondTargetArrow.visible = false;
            }
        }
        
        function showReplayButton() {
            replayB.style.display = '';
        }
        
        function hideReplayButton() {
            replayB.style.display = 'none';
        }
        
        function showNavigationArrows() {
            prevB.style.display = '';
            nextB.style.display = '';
        }
        
        function hideNavigationArrows() {
            prevB.style.display = 'none';
            nextB.style.display = 'none';
        }
        
        function showPrevButton() {
            prevB.style.display = '';
        }
        
        function hidePrevButton() {
            prevB.style.display = 'none';
        }
        
        function showNextButton() {
            nextB.style.display = '';
        }
        
        function hideNextButton() {
            nextB.style.display = 'none';
        }
        
        function showInfoButton() {
            infoB.style.display = '';
        }
        
        function hideInfoButton() {
            infoB.style.display = 'none';
        }
        
        function showInfoModal() {
            infoContent.textContent = infoText;
            infoModal.style.display = 'flex';
            requestAnimationFrame(() => {
                infoModal.style.opacity = '1';
            });
        }
        
        function hideInfoModal() {
            infoModal.style.opacity = '0';
            setTimeout(() => {
                infoModal.style.display = 'none';
            }, 300);
        }
        
        function deactivateFirstTargetContent() {
            console.log('[Target 1] Deactivating current content.');
            models.forEach((m, i) => {
                if (m) {
                    m.visible = false;
                }
                if (slotControllers[i]?.onLeave) {
                    try {
                        slotControllers[i].onLeave();
                    } catch (err) {
                        console.error(`[Target 1] Error during onLeave for slot ${i}:`, err);
                    }
                }
            });
            hideFirstTargetOccluders();
            targetFound = false;
            firstTargetCurrentlyTracked = false;
        }

        function handleFirstTargetCompletion() {
            if (secondTargetPromptShown) return;
            secondTargetPromptShown = true;
            allScenesCompleted = true;
            console.log('✅ All first target scenes complete. Prompting user to move to the second sign.');
            clearTimeout(secondTargetPromptDelayTimer);
            secondTargetPromptDelayTimer = setTimeout(() => {
                awaitingSecondTarget = true;
                deactivateFirstTargetContent();
                showSecondTargetPrompt();
                showSecondTargetArrow();
                // Hide next button (we're on last scene)
                hideNextButton();
                // Keep prev and replay buttons visible so users can navigate back or replay
                showPrevButton();
                // Keep replay button visible so users can replay the scene
                // hideReplayButton();
                hideInfoButton();
                targetFound = false;
            }, 2000);
            if (!secondAnchorInitialized) {
                initializeSecondAnchor();
            }
        }
        
        

        // ---------- OCCLUSION HELPERS ----------
        // Prepare content models for proper depth rendering
        function prepContent(root){
            root.traverse(o => {
                if (o.isMesh) {
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    mats.forEach(m => {
                        if (!m) return;
                        m.depthTest = true;
                        m.depthWrite = true;
                        m.colorWrite = true;
                        // Pull content slightly forward to appear in front of occluders
                        m.polygonOffset = true;
                        m.polygonOffsetFactor = -2;  // Negative = pull forward
                        m.polygonOffsetUnits = -2;   // Pull forward
                    });
                    o.renderOrder = 1; // draw AFTER occluders
                }
            });
        }

        // Prepare occluder models (invisible depth writers)
        function prepOccluder(root){
            root.traverse(o => {
                if (o.isMesh) {
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    mats.forEach(m => {
                        if (!m) return;
                        // invisible but writes to depth buffer
                        m.colorWrite = false;
                        m.depthWrite = true;
                        m.depthTest  = true;
                        // Push occluder depth back to allow recessed windows (1mm deep) to appear
                        m.polygonOffset = true;
                        m.polygonOffsetFactor = 2;  // Positive = push back (was -2)
                        m.polygonOffsetUnits  = 2;  // Push back by ~2mm
                    });
                    o.renderOrder = 0; // draw BEFORE content
                }
            });
        }



        // Show/hide models based on current scene and handle scene transitions
        function applyVisibility() {
            models.forEach((m, i) => { if (m) m.visible = (i === index); });
            
            // CRITICAL: Always ensure other targets' models are hidden when first target is active
            if (targetFound && !secondTargetActive && !thirdTargetActive) {
                secondModels.forEach(m => { if (m) m.visible = false; });
                thirdModels.forEach(m => { if (m) m.visible = false; });
            }
            
            // fire leave/enter once per slot change
            if (lastActive !== index) {
                if (lastActive >= 0 && slotControllers[lastActive]?.onLeave) {
                    slotControllers[lastActive].onLeave();
                }
                if (slotControllers[index]?.onEnter) {
                    slotControllers[index].onEnter();
                }
                // Mark this scene as viewed
                if (models[index]) {
                    markSceneViewed(index);
                }
                
                lastActive = index;
            }
            
            updateLabel();
            updateNavigationButtons();
        }

        function nextLoaded(from, dir) {
        // walk circularly through fixed slots, skipping unloaded ones
            let i = from;
            for (let step = 0; step < TOTAL; step++) {
                i = (i + dir + TOTAL) % TOTAL;
                if (models[i]) return i;
            }
            return from; 
        }


        function showDelta(delta) {
            if (countLoaded() === 0) return;
            index = nextLoaded(index, delta >= 0 ? +1 : -1);
            applyVisibility();
        }

        // Replay current scene function
        function replayCurrentScene() {
            // If we're awaiting the next target, hide the prompt and reset the flag so it can appear again
            if (awaitingSecondTarget) {
                console.log('Replay clicked while awaiting second target - hiding prompt and replaying...');
                hideSecondTargetPrompt();
                hideSecondTargetArrow();
                secondTargetPromptShown = false; // Reset flag so prompt can appear again after replay
                clearTimeout(secondTargetPromptDelayTimer);
                awaitingSecondTarget = false;
                // Reactivate the content for replay
                targetFound = true;
                showFirstTargetOccluders();
                // Show navigation buttons (prev button should be visible if not on first scene)
                showNavigationArrows();
                // Make sure the current scene is visible
                applyVisibility();
            }
            
            console.log(`Replaying scene ${index}...`);
            const controller = slotControllers[index];
            if (controller && controller.isComposite) {
                // Reset and restart the composite sequence
                controller.onLeave(); // Clean up current state
                controller.onEnter(); // Restart sequence
                console.log(`Scene ${index} replay initiated`);
            } else {
                console.log(`Scene ${index} is not a composite scene, no replay needed`);
            }
        }

        // Set up navigation button handlers for all targets
        const goPrev = () => {
            // If we're awaiting the next target, hide the prompt and allow navigation
            if (awaitingSecondTarget) {
                console.log('Prev clicked while awaiting second target - hiding prompt and navigating...');
                hideSecondTargetPrompt();
                hideSecondTargetArrow();
                secondTargetPromptShown = false;
                clearTimeout(secondTargetPromptDelayTimer);
                awaitingSecondTarget = false;
                targetFound = true;
                showFirstTargetOccluders();
                showNavigationArrows();
            } else if (awaitingThirdTarget) {
                console.log('Prev clicked while awaiting third target - hiding prompt and navigating...');
                hideThirdTargetPrompt();
                thirdTargetPromptShown = false;
                clearTimeout(thirdTargetPromptDelayTimer);
                awaitingThirdTarget = false;
                secondTargetFound = true;
                secondTargetActive = true;
                showSecondTargetOccluders();
                showNavigationArrows();
            }
            
            if (thirdTargetActive) {
                // Third target has only one scene, so prev does nothing
                return;
            } else if (secondTargetActive) {
                secondShowDelta(-1);
            } else {
                showDelta(-1);
            }
        };
        const goNext = () => {
            if (thirdTargetActive) {
                // Third target has only one scene, so next does nothing
                return;
            } else if (secondTargetActive) {
                secondShowDelta(+1);
            } else {
                // Check if on first target and all scenes completed
                if (index === TOTAL - 1 && allScenesCompleted && !secondAnchorInitialized) {
                    // User clicked next after completing all first target scenes
                    // Initialize second target and show message
                    console.log('🚀 Initializing second target...');
                    initializeSecondAnchor();
            } else {
                showDelta(+1);
                }
            }
        };
        const goReplay = () => {
            // Check if we're awaiting a target (prompt is showing) - handle replay for that target
            if (awaitingThirdTarget) {
                // We're on second target's last scene with prompt showing
                replaySecondTargetScene();
            } else if (awaitingSecondTarget) {
                // We're on first target's last scene with prompt showing
                replayCurrentScene();
            } else if (thirdTargetActive) {
                replayThirdTargetScene();
            } else if (secondTargetActive) {
                replaySecondTargetScene();
            } else {
                replayCurrentScene();
            }
        };
        
        function replayThirdTargetScene() {
            console.log(`Replaying third target scene ${thirdIndex}...`);
            const controller = thirdSlotControllers[thirdIndex];
            if (controller && controller.isComposite) {
                controller.onLeave();
                controller.onEnter();
                console.log(`Third target scene ${thirdIndex} replay initiated`);
            } else {
                console.log(`Third target scene ${thirdIndex} is not a composite scene, no replay needed`);
            }
        }
        prevB.addEventListener('click', goPrev);
        nextB.addEventListener('click', goNext);
        replayB.addEventListener('click', goReplay);
        infoB.addEventListener('click', showInfoModal);
        infoCloseBtn.addEventListener('click', hideInfoModal);
        
        // Close modal when clicking outside
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) {
                hideInfoModal();
            }
        });
        
        // Function to update navigation button states
        function updateNavigationButtons() {
            const currentSlot = slotControllers[index];
            const loadedCount = countLoaded();
            
            // If only one scene, only show replay button
            if (TOTAL === 1) {
                hidePrevButton();
                hideNextButton();
                return;
            }
            
            // Check if we can go to previous scene
            const canGoPrev = index > 0;
            if (canGoPrev) {
                showPrevButton();
                prevB.disabled = false;
                prevB.style.opacity = '1';
            } else {
                hidePrevButton();
            }
            
            // Check if there's a next scene available
            const hasNextScene = index < loadedCount - 1;
            
            // Check if current scene is completed (all parts visible for composite scenes)
            let sceneCompleted = false;
            if (currentSlot && currentSlot.isComposite) {
                sceneCompleted = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
            } else {
                sceneCompleted = true; // For regular slots, consider completed immediately
            }
            
            // Handle next button visibility and state
            if (index === TOTAL - 1 && !allScenesCompleted) {
                // On last scene and not all scenes completed - hide next button
                hideNextButton();
            } else if (hasNextScene) {
                // There's a next scene - always show next button
                showNextButton();
                if (sceneCompleted) {
                    // Scene completed - active next button
                    nextB.disabled = false;
                    nextB.style.opacity = '1';
                } else {
                    // Scene not completed - inactive next button at 50% opacity
                    nextB.disabled = true;
                    nextB.style.opacity = '0.5';
                }
            } else {
                // No next scene - hide next button
                hideNextButton();
            }
            
            // Update info button state (same logic as next button)
            let canShowInfo = false;
            if (currentSlot && currentSlot.isComposite) {
                // For composite slots, check if all parts are visible
                const allPartsVisible = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
                canShowInfo = allPartsVisible;
            } else {
                canShowInfo = true; // For regular slots, always allow info
            }
            
            infoB.disabled = !canShowInfo;
            infoB.style.opacity = canShowInfo ? '1' : '0.5';
        }

        // Show HUD only while target is tracked
        anchor.onTargetFound = () => { 
            firstTargetCurrentlyTracked = true;
            // CRITICAL: Only activate Target 1 if no other target is active
            if (secondTargetActive || thirdTargetActive) {
                console.log('⚠️ Target 1 found but another target is active - ignoring to prevent interference');
                return; // Don't activate first target if another is active
            }
            if (awaitingSecondTarget || awaitingThirdTarget) {
                console.log('⚠️ Target 1 found but we are awaiting another target - ignoring.');
                return;
            }
            
            console.log('🎯 Target 1 found! Activating...');
            hud.hidden = false; 
            showNavigationArrows();
            showReplayButton();
            showInfoButton();
            
            // Hide all other targets' models
            secondModels.forEach(m => { if (m) m.visible = false; });
            thirdModels.forEach(m => { if (m) m.visible = false; });
            
            // Initialize smoothed group position on first detection to prevent initial snap
            if (!targetFound) {
                anchor.group.getWorldPosition(smoothed.position);
                anchor.group.getWorldQuaternion(smoothed.quaternion);
                anchor.group.getWorldScale(smoothed.scale);
            }
            
            targetFound = true;
            
            console.log(`Target 1 found! Current slot: ${index}, slotControllers[${index}]:`, slotControllers[index]);
            
            // Deactivate other targets
            secondTargetActive = false;
            
            // Show first target occluders
            showFirstTargetOccluders();
            // Hide second target occluders when first target is active
            hideSecondTargetOccluders();
            
            // Re-apply visibility to show current scene
            applyVisibility();
            
            // Trigger composite sequence if we're on a composite slot and it hasn't started yet
            if (slotControllers[index] && slotControllers[index].isComposite && !slotControllers[index].started) {
                console.log(`Target found, starting composite sequence for slot ${index}...`);
                slotControllers[index].startSequenceIfReady();
            } else {
                console.log(`Target found but not starting composite sequence - slotControllers[${index}]:`, slotControllers[index] ? `isComposite: ${slotControllers[index].isComposite}, started: ${slotControllers[index].started}` : 'null');
            }
        };
        anchor.onTargetLost = () => { 
            console.log('Target 1 lost.');
            targetFound = false;
            firstTargetCurrentlyTracked = false;
            // Only hide HUD if no other target is active
            if (!secondTargetActive) {
                hud.hidden = true;
            }
            // Note: We don't hide the models here, as user might switch to another target
        };
        
        // ============ LOAD OCCLUDERS (for FIRST target only) ============
        // Array to track all occluders for visibility management
        const firstTargetOccluders = [];
        
        // Helper functions to show/hide first target occluders
        function showFirstTargetOccluders() {
            firstTargetOccluders.forEach(occ => { if (occ) occ.visible = true; });
            console.log('[OCCLUDER] First target occluders shown');
        }
        
        function hideFirstTargetOccluders() {
            firstTargetOccluders.forEach(occ => { if (occ) occ.visible = false; });
            console.log('[OCCLUDER] First target occluders hidden');
        }
        
        // Occluder 1 - Closest/Shortest buildings
        loader.load(
            "./assets/DataModel11_3/GhostBina1.gltf",
            (gltf) => {
                const ghostScene = gltf.scene;
                ghostScene.position.set(0, 0, 0);
                ghostScene.rotation.set(0, 0, 0);
                ghostScene.name = 'occluder-ghost1';
                prepOccluder(ghostScene);        // make it "ghost"
                smoothed.add(ghostScene);        // Add to smoothed group for consistent positioning
                ghostScene.visible = true;
                firstTargetOccluders.push(ghostScene);
                console.log("[OCCLUDER] Ghost1 (closest layer) loaded on first target");
            },
            undefined,
            (err) => console.error("[GLTF] ghost1 load error:", err)
        );

        // Occluder 2 - Middle depth buildings
        loader.load(
            "./assets/DataModel11_3/GhostBina2.gltf",
            (gltf) => {
                const ghostScene = gltf.scene;
                ghostScene.position.set(0, 0, 0);
                ghostScene.rotation.set(0, 0, 0);
                ghostScene.name = 'occluder-ghost2';
                prepOccluder(ghostScene);        // make it "ghost"
                smoothed.add(ghostScene);        // Add to smoothed group for consistent positioning
                ghostScene.visible = true;
                firstTargetOccluders.push(ghostScene);
                console.log("[OCCLUDER] Ghost2 (middle layer) loaded on first target");
            },
            undefined,
            (err) => console.error("[GLTF] ghost2 load error:", err)
        );

        // Occluder 3 - Furthest/Tallest buildings
        loader.load(
            "./assets/DataModel11_3/GhostBina3.gltf",
            (gltf) => {
                const ghostScene = gltf.scene;
                ghostScene.position.set(0, 0, 0);
                ghostScene.rotation.set(0, 0, 0);
                ghostScene.name = 'occluder-ghost3';
                prepOccluder(ghostScene);        // make it "ghost"
                smoothed.add(ghostScene);        // Add to smoothed group for consistent positioning
                ghostScene.visible = true;
                firstTargetOccluders.push(ghostScene);
                console.log("[OCCLUDER] Ghost3 (furthest layer) loaded on first target");
            },
            undefined,
            (err) => console.error("[GLTF] ghost3 load error:", err)
        );

        // Occluder 4 - Target model itself (blocks objects that move behind it)
        // This is a 3D model of the first image target - most content appears in front,
        // but some objects (like poster) move behind it at an angle and need to be occluded
        loader.load(
            "./assets/DataModel11_3/ghostposter.gltf",
            (gltf) => {
                console.log("[OCCLUDER] Target model occluder loaded successfully");
                const ghostScene = gltf.scene;
                // Position at target plane (slightly back to match actual target surface)
                ghostScene.position.set(0, 0, 0.001);
                ghostScene.rotation.set(0, 0, 0);
                ghostScene.name = 'occluder-ghostgunes';
                
                // Custom occluder setup - less aggressive offset so it sits at target surface
                // This allows it to properly occlude objects that move behind it
                ghostScene.traverse(o => {
                    if (o.isMesh) {
                        const mats = Array.isArray(o.material) ? o.material : [o.material];
                        mats.forEach(m => {
                            if (!m) return;
                            // invisible but writes to depth buffer
                            m.colorWrite = false;
                            m.depthWrite = true;
                            m.depthTest = true;
                            // Less aggressive offset - sits closer to target surface
                            // This ensures objects moving behind it get properly occluded
                            m.polygonOffset = true;
                            m.polygonOffsetFactor = 0.5;  // Much less push back (was 2)
                            m.polygonOffsetUnits = 0.5;  // Closer to actual target surface
                        });
                        o.renderOrder = 0; // draw BEFORE content
                    }
                });
                
                smoothed.add(ghostScene);        // Add to smoothed group for consistent positioning
                ghostScene.visible = true;
                firstTargetOccluders.push(ghostScene);
                console.log("[OCCLUDER] Ghost4 (target model) added to scene - visible:", ghostScene.visible);
                console.log("[OCCLUDER] Ghost4 position:", ghostScene.position);
                console.log("[OCCLUDER] Ghost4 in smoothed group:", smoothed.children.includes(ghostScene));
                console.log("[OCCLUDER] Total occluders loaded:", firstTargetOccluders.length);
            },
            (progress) => {
                // Log loading progress
                if (progress.lengthComputable) {
                    const percentComplete = (progress.loaded / progress.total) * 100;
                    console.log(`[OCCLUDER] Target model occluder loading: ${percentComplete.toFixed(0)}%`);
                }
            },
            (err) => {
                console.error("[GLTF] ghost4 (target model) load error:", err);
                console.error("[GLTF] Error details:", err.message, err.stack);
            }
        );

        // ============ LOAD OCCLUDERS (for SECOND target) ============
        const secondTargetOccluders = [];
        
        // ============ LOAD SECOND TARGET ARROW GUIDE ============
        loader.load(
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",
            (gltf) => {
                secondTargetArrow = gltf.scene;
                secondTargetArrow.name = 'second-target-guide-arrow';
                secondTargetArrow.visible = shouldShowSecondTargetArrow;
                secondTargetArrow.traverse(o => {
                    if (o.isMesh) {
                        o.castShadow = false;
                        o.receiveShadow = false;
                    }
                });
                prepContent(secondTargetArrow);
                smoothed.add(secondTargetArrow);
                if (!shouldShowSecondTargetArrow) {
                    secondTargetArrow.visible = false;
                }
                console.log('[Guide] Second target arrow loaded and attached to smoothed group.');
            },
            undefined,
            (err) => console.error('[GLTF] second target arrow load error:', err)
        );
        
        function showSecondTargetOccluders() {
            secondTargetOccluders.forEach(occ => { if (occ) occ.visible = true; });
            console.log('[OCCLUDER] Second target occluders shown');
        }
        
        function hideSecondTargetOccluders() {
            secondTargetOccluders.forEach(occ => { if (occ) occ.visible = false; });
            console.log('[OCCLUDER] Second target occluders hidden');
        }
        
        function loadSecondTargetOccluders() {
            if (!secondSmoothed) return;
            console.log('[OCCLUDER] Loading second target occluders...');
            
            // Occluder 1 - example GLTF occluder (match first-target style)
            loader.load(
                "./assets/DataModel11_3/Franz/ghostbina1.gltf",
                (gltf) => {
                    const ghostScene = gltf.scene;
                    ghostScene.position.set(0, 0, -0.001); // Slightly forward to ensure proper occlusion
                    ghostScene.rotation.set(0, 0, 0);
                    ghostScene.name = 'second-occluder-ghost1';
                    prepOccluder(ghostScene);
                    secondSmoothed.add(ghostScene);
                    ghostScene.visible = true;
                    secondTargetOccluders.push(ghostScene);
                    console.log("[OCCLUDER] Second target Ghost1 loaded at z:", ghostScene.position.z);
                },
                undefined,
                (err) => console.error("[GLTF] second ghost1 load error:", err)
            );

            loader.load(
                "./assets/DataModel11_3/Franz/ghostbina2.gltf",
                (gltf) => {
                    const ghostScene = gltf.scene;
                    ghostScene.position.set(0, 0, -0.002); // Slightly more forward than ghost1
                    ghostScene.rotation.set(0, 0, 0);
                    ghostScene.name = 'second-occluder-ghost2';
                    prepOccluder(ghostScene);
                    secondSmoothed.add(ghostScene);
                    ghostScene.visible = true;
                    secondTargetOccluders.push(ghostScene);
                    console.log("[OCCLUDER] Second target Ghost2 loaded at z:", ghostScene.position.z);
                },
                undefined,
                (err) => console.error("[GLTF] second ghost2 load error:", err)
            );

            // Occluder 3 - Poster occluder (for Barsabit object)
            // This represents two posters at 30-degree angle (V-shape)
            // Blocks Barsabit object when it moves behind the posters
            loader.load(
                "./assets/DataModel11_3/Franz/ghostposter.gltf",
                (gltf) => {
                    const ghostScene = gltf.scene;
                    // Position at target plane (slightly back to match actual poster surface)
                    ghostScene.position.set(0, 0, 0);
                    ghostScene.rotation.set(0, 0, 0);
                    ghostScene.name = 'second-occluder-ghost3';
                    // Ensure occluder is never culled accidentally
                    ghostScene.frustumCulled = false;
                    
                    // Custom occluder setup - less aggressive offset so it sits at poster surface
                    // This allows it to properly occlude Barsabit when it moves behind the posters
                    ghostScene.traverse(o => {
                        if (o.isMesh) {
                            const mats = Array.isArray(o.material) ? o.material : [o.material];
                            mats.forEach(m => {
                                if (!m) return;
                                // invisible but writes to depth buffer
                                m.colorWrite = false;
                                m.depthWrite = true;
                                m.depthTest = true;
                                // Less aggressive offset - sits closer to poster surface
                                // This ensures Barsabit moving behind it gets properly occluded
                                m.polygonOffset = true;
                                m.polygonOffsetFactor = 0.5;  // Much less push back (was 1, default is 2)
                                m.polygonOffsetUnits = 0.5;  // Closer to actual poster surface
                            });
                            o.renderOrder = 0; // draw BEFORE content
                        }
                    });
                    
                    secondSmoothed.add(ghostScene);
                    ghostScene.visible = true;
                    secondTargetOccluders.push(ghostScene);
                    // Diagnostics
                    let meshCount = 0;
                    ghostScene.traverse(o => { if (o.isMesh) meshCount++; });
                    console.log("[OCCLUDER] Second target Ghost3 (poster 1) loaded | meshes:", meshCount, '| position:', ghostScene.position, '| in secondSmoothed:', secondSmoothed.children.includes(ghostScene));
                },
                undefined,
                (err) => console.error("[GLTF] second ghost3 load error:", err)
            );

            // Occluder 4 - Second poster occluder (for Barsabit object)
            // Second poster in the V-shape configuration
            // Partially blocks Barsabit object when it moves behind this poster
            loader.load(
                "./assets/DataModel11_3/Franz/ghostposter2.gltf",
                (gltf) => {
                    const ghostScene = gltf.scene;
                    // Position slightly back (positive Z) to avoid impacting objects in front
                    // This allows it to partially occlude Barsabit when it moves behind
                    ghostScene.position.set(0, 0, 0.0000);
                    ghostScene.rotation.set(0, 0, 0);
                    ghostScene.name = 'second-occluder-ghost4';
                    // Ensure occluder is never culled accidentally
                    ghostScene.frustumCulled = false;
                    
                    // Custom occluder setup for partial occlusion of Barsabit
                    // Very minimal offset to ensure precise depth interaction
                    ghostScene.traverse(o => {
                        if (o.isMesh) {
                            const mats = Array.isArray(o.material) ? o.material : [o.material];
                            mats.forEach(m => {
                                if (!m) return;
                                // invisible but writes to depth buffer
                                m.colorWrite = false;
                                m.depthWrite = true;
                                m.depthTest = true;
                                // Very minimal offset - just enough for depth buffer interaction
                                // This allows partial occlusion of Barsabit when it's behind the poster
                                m.polygonOffset = true;
                                m.polygonOffsetFactor = 0.1;  // Very minimal push back for precise occlusion
                                m.polygonOffsetUnits = 0.1;  // Minimal offset to avoid affecting front objects
                            });
                            o.renderOrder = 0; // draw BEFORE content
                        }
                    });
                    
                    secondSmoothed.add(ghostScene);
                    ghostScene.visible = true;
                    secondTargetOccluders.push(ghostScene);
                    // Diagnostics
                    let meshCount = 0;
                    ghostScene.traverse(o => { if (o.isMesh) meshCount++; });
                    console.log("[OCCLUDER] Second target Ghost4 (poster 2) loaded | meshes:", meshCount, '| position:', ghostScene.position, '| in secondSmoothed:', secondSmoothed.children.includes(ghostScene));
                },
                undefined,
                (err) => console.error("[GLTF] second ghost4 load error:", err)
            );
        }

        // ============ LOAD YOUR MODELS (per-model transforms) ============

        function register(obj, slot) {
            obj.visible = false;              // avoid a flash before we choose
            smoothed.add(obj);                // attach to smoothed group instead of anchor.group
            models[slot] = obj;               // place into fixed slot
            applyVisibility();
        }
        
        // Second smoothed group (for middle target - will be created when second anchor is initialized)
        let secondSmoothed = null;
        
        // Register function for second target
        function secondRegister(obj, slot) {
            obj.visible = false;
            if (secondSmoothed) {
                secondSmoothed.add(obj);      // attach to second smoothed group
                console.log(`[Target 2] Registered model for slot ${slot}, added to secondSmoothed. Children count: ${secondSmoothed.children.length}`);
            } else {
                console.error(`[Target 2] ERROR: secondSmoothed does not exist when trying to register slot ${slot}!`);
                // Try to add directly to scene as fallback
                scene.add(obj);
                console.warn(`[Target 2] Added model directly to scene as fallback`);
            }
            secondModels[slot] = obj;
            console.log(`[Target 2] Model registered for slot ${slot}, total models: ${secondModels.filter(Boolean).length}`);
            secondApplyVisibility();
        }




        // composite slot — multiple GLTFs in one scene, with sequential reveals
        // files: array of file paths (order = reveal order)
        // timing: array of absolute times in milliseconds (when each part should appear, first part at 0)
        // hideAfter: array of durations in milliseconds (how long each part stays visible, 0 = stays forever)
        function loadComposite(
            slot,
            files,
            timing, // array of absolute times in ms, e.g. [0, 2000, 5000] means: part0 at 0ms, part1 at 2000ms, part2 at 5000ms
            hideAfter, // array of durations in ms, e.g. [3000, 0, 0] means: part0 hides after 3s, part1&2 stay forever
            { resetOnLeave=true, exclusive=false, resetOnEnter=true, onComplete=null } = {}
        ) {
            const group = new THREE.Group();
            group.name = `composite-slot-${slot}`;
            register(group, slot);

            const parts = [];            // roots per part (in reveal order)
            let timers = [];
            let allLoaded = 0;

            const clearTimers = () => { timers.forEach(id => clearTimeout(id)); timers = []; };


            function hidePart(i) {
                const p = parts[i];
                if (!p) return;
                
                console.log(`Hiding part ${i} after ${hideAfter[i]}ms`);
                p.visible = false;
                
                // Stop animations for this part
                stopAnimationsForPart(p);
                
                // Update navigation buttons after hiding part
                updateNavigationButtons();
            }

            function revealPart(i) {
                if (exclusive) parts.forEach((p, j) => { if (p) p.visible = (j === i); });

                const p = parts[i];
                if (!p) return;

                console.log(`Revealing part ${i}`);
                p.visible = true;

                // Start animations for this part
                startAnimationsForPart(p);

                // Set up auto-hide timer if specified
                if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                    const hideTimer = setTimeout(() => {
                        hidePart(i);
                    }, hideAfter[i]);
                    timers.push(hideTimer);
                    console.log(`Scheduled part ${i} to hide after ${hideAfter[i]}ms`);
                } else {
                    // This is a permanent part (hideAfter = 0), check if navigation should be enabled
                    console.log(`Part ${i} is permanent, checking navigation...`);
                }
                
                // Update navigation buttons after revealing part
                updateNavigationButtons();
            }

            function startSequence() {
                if (slotControllers[slot].started) return;  // already started
                if (allLoaded < files.length) {
                    console.log(`Cannot start sequence: ${files.length - allLoaded} parts still loading`);
                    return;  // wait for all loaded
                }
                
                console.log(`Starting composite sequence with ${files.length} parts`);
                slotControllers[slot].started = true;
                clearTimers();
                
                // Normalize timing so that time zero is when the FIRST part appears
                const firstTime = (Array.isArray(timing) && timing.length > 0) ? (timing[0] || 0) : 0;
                files.forEach((_, i) => {
                    const absoluteTime = timing[i] || 0;
                    const relativeTime = Math.max(0, absoluteTime - firstTime);
                    const id = setTimeout(() => {
                        console.log(`Revealing part ${i} at ${relativeTime}ms (relative to first part at ${firstTime}ms)`);
                        revealPart(i);
                    }, relativeTime);
                    timers.push(id);
                });
            }

            function hideAllParts() {
                parts.forEach(p => { 
                    if (p) {
                        p.visible = false;
                        stopAnimationsForPart(p);
                    }
                });
            }

            // Animation handling functions
            function startAnimationsForPart(part) {
                const target = part; // play clips on the root part
                const clips = (target.userData && Array.isArray(target.userData.clips)) ? target.userData.clips : [];
                if (!clips.length) return;

                const mixer = new THREE.AnimationMixer(target);
                target.userData.mixers = target.userData.mixers || [];
                target.userData.mixers.push(mixer);

                clips.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.reset();
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.time = 0;
                    action.enabled = true;
                    action.setEffectiveWeight(1.0);
                    action.fadeIn(0);
                    action.play();
                    console.log(`Started animation: ${clip.name} on composite part root (play once)`);
                });
            }

            function stopAnimationsForPart(part) {
                part.traverse((child) => {
                    if (child.userData.mixers) {
                        child.userData.mixers.forEach(mixer => mixer.stopAllAction());
                        child.userData.mixers = [];
                    }
                });
            }

            // controller hooks for this slot
            slotControllers[slot] = {
                isComposite: true, // Flag to identify this as a composite slot
                started: false, // Track if sequence has started
                completed: false,
                
                onEnter() {
                    console.log(`[Target 1] Composite slot ${slot} entered, targetFound: ${targetFound}, allLoaded: ${allLoaded}/${files.length}`);
                    // Ensure other targets' models are hidden
                    secondModels.forEach(m => { if (m) m.visible = false; });
                    
                    if (resetOnEnter) {
                        clearTimers();
                        hideAllParts();
                        this.started = false;
                        this.completed = false;
                    }
                    
                    // Check if target is already found and start sequence immediately
                    if (targetFound && allLoaded >= files.length) {
                        console.log(`Composite slot ${slot} entered with target already found, starting sequence immediately...`);
                        startSequence();
                        this.started = true;
                    } else {
                        console.log(`Composite slot ${slot} entered, waiting for target recognition...`);
                    }
                },
                onLeave() {
                    clearTimers();
                    if (resetOnLeave) { hideAllParts(); }
                    this.started = false;
                    if (!resetOnEnter) {
                        this.completed = false;
                    }
                },
                startSequenceIfReady() {
                    // Only start if target is found and we haven't started yet
                    if (targetFound && !this.started) {
                        console.log(`Starting composite sequence for slot ${slot} (target found, all ready)`);
                        if (allLoaded >= files.length) {
                            startSequence();
                            this.started = true;
                        } else {
                            console.log(`Waiting for ${files.length - allLoaded} more parts to load...`);
                        }
                    }
                },
                areAllPartsVisible() {
                    // Check if all parts that should STAY visible (hideAfter = 0) are actually visible
                    // Parts with hideAfter > 0 are temporary, so we ignore them for navigation
                    const result = parts.every((part, i) => {
                        if (!part) return true; // If part doesn't exist, consider it "visible"
                        // If this part has auto-hide (hideAfter > 0), don't check its visibility
                        if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                            return true; // Temporary parts don't block navigation
                        }
                        const isVisible = part.visible;
                        if (!isVisible) {
                            console.log(`Slot ${slot}: Permanent part ${i} is not visible yet`);
                        }
                        return isVisible; // Permanent parts must be visible
                    });
                    if (result) {
                        console.log(`✅ Slot ${slot}: All permanent parts are visible! Navigation enabled.`);
                        if (onComplete && !this.completed && this.started && allLoaded >= files.length) {
                            this.completed = true;
                            try {
                                onComplete(slot);
                            } catch (err) {
                                console.error(`[Composite] onComplete callback for slot ${slot} failed:`, err);
                            }
                        }
                    }
                    return result;
                }
            };

            // load each file; start sequence when all loaded
            files.forEach((path, i) => {
                console.log(`Loading composite part ${i}: ${path}`);
                loader.load(path, (gltf) => {
                    console.log(`Loaded part ${i}: ${path}`);
                    const root = gltf.scene;
                    root.visible = false;
                    root.position.set(0,0,0);
                    root.rotation.set(0,0,0);
                    // Attach animations from the GLTF to the root so we can play them later
                    root.userData = root.userData || {};
                    root.userData.clips = Array.isArray(gltf.animations) ? gltf.animations : [];
                    prepContent(root);     // draw after occluders
                    group.add(root);
                    parts[i] = root;

                    allLoaded++;
                    console.log(`Part ${i} loaded. Total loaded: ${allLoaded}/${files.length}`);
                    // Check if we should start sequence (target found and all loaded)
                    if (models[slot] === group && index === slot && targetFound) {
                        slotControllers[slot].startSequenceIfReady();
                    }
                });
            });
        }

        // ============ LOAD COMPOSITE FOR SECOND TARGET ============
        // Similar to loadComposite but for second target scenes
        function secondLoadComposite(slot, files, timing, hideAfter, { resetOnLeave=true, exclusive=false, resetOnEnter=true, onComplete=null } = {}) {
            console.log(`[Target 2] Loading composite slot ${slot} with ${files.length} files`);
            
            const group = new THREE.Group();
            group.name = `second-composite-slot-${slot}`;
            secondRegister(group, slot);

            const parts = [];
            let timers = [];
            let allLoaded = 0;

            const clearTimers = () => { timers.forEach(id => clearTimeout(id)); timers = []; };

            function hidePart(i) {
                const p = parts[i];
                if (!p) return;
                console.log(`[Second Target] Hiding part ${i} after ${hideAfter[i]}ms`);
                p.visible = false;
                stopAnimationsForPart(p);
                
                // Update navigation buttons after hiding part
                secondUpdateNavigationButtons();
            }

            function revealPart(i) {
                if (exclusive) {
                    parts.forEach((p, j) => {
                        if (p) {
                            p.visible = (j === i);
                            if (j !== i) stopAnimationsForPart(p);
                        }
                    });
                }

                const p = parts[i];
                if (!p) return;
                console.log(`[Second Target] Revealing part ${i}`);
                p.visible = true;
                startAnimationsForPart(p);

                if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                    const hideTimer = setTimeout(() => {
                        hidePart(i);
                    }, hideAfter[i]);
                    timers.push(hideTimer);
                    console.log(`[Second Target] Scheduled part ${i} to hide after ${hideAfter[i]}ms`);
                } else {
                    // This is a permanent part (hideAfter = 0), check if navigation should be enabled
                    console.log(`[Second Target] Part ${i} is permanent, checking navigation...`);
                }
                
                // Update navigation buttons after revealing part
                secondUpdateNavigationButtons();
            }

            function startAnimationsForPart(part) {
                const target = part;
                const clips = (target.userData && Array.isArray(target.userData.clips)) ? target.userData.clips : [];
                if (!clips.length) return;

                const mixer = new THREE.AnimationMixer(target);
                target.userData.mixers = target.userData.mixers || [];
                target.userData.mixers.push(mixer);

                clips.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.reset();
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.time = 0;
                    action.enabled = true;
                    action.setEffectiveWeight(1.0);
                    action.fadeIn(0);
                    action.play();
                });
            }

            function stopAnimationsForPart(part) {
                part.traverse((child) => {
                    if (child.userData.mixers) {
                        child.userData.mixers.forEach(mixer => mixer.stopAllAction());
                        child.userData.mixers = [];
                    }
                });
            }

            function startSequence() {
                if (secondSlotControllers[slot].started) return;
                if (allLoaded < files.length) return;
                
                secondSlotControllers[slot].started = true;
                clearTimers();
                
                // Normalize timing so that time zero is when the FIRST part appears (absolute timing like first target)
                const firstTime = (Array.isArray(timing) && timing.length > 0) ? (timing[0] || 0) : 0;
                files.forEach((_, i) => {
                    const absoluteTime = timing[i] || 0;
                    const relativeTime = Math.max(0, absoluteTime - firstTime);
                    const id = setTimeout(() => {
                        console.log(`[Target 2] Revealing part ${i} at ${relativeTime}ms (relative to first part at ${firstTime}ms)`);
                        revealPart(i);
                    }, relativeTime);
                    timers.push(id);
                });
            }

            function hideAllParts() {
                parts.forEach(p => {
                    if (p) {
                        p.visible = false;
                        stopAnimationsForPart(p);
                    }
                });
            }

            secondSlotControllers[slot] = {
                isComposite: true,
                started: false,
                completed: false,
                
                onEnter() {
                    console.log(`[Target 2] Scene ${slot} onEnter - ${files.length} files, allLoaded: ${allLoaded}`);
                    // Ensure first target models are hidden
                    models.forEach(m => { if (m) m.visible = false; });
                    
                    if (resetOnEnter) {
                        clearTimers();
                        hideAllParts();
                        this.started = false;
                        this.completed = false; // Reset completed flag so onComplete can be called again on replay
                    }
                    
                    if (secondTargetFound && allLoaded >= files.length) {
                        startSequence();
                        this.started = true;
                    }
                },
                onLeave() {
                    clearTimers();
                    if (resetOnLeave) { hideAllParts(); }
                    this.started = false;
                },
                startSequenceIfReady() {
                    if (secondTargetFound && !this.started) {
                        if (allLoaded >= files.length) {
                            startSequence();
                            this.started = true;
                        }
                    }
                },
                areAllPartsVisible() {
                    // For empty scenes, consider all parts visible
                    if (files.length === 0) return true;
                    
                    // Check if all PERMANENT parts (hideAfter = 0) are visible
                    // Temporary parts (hideAfter > 0) don't block navigation
                    const result = parts.every((part, i) => {
                        if (!part) return true; // If part doesn't exist, consider it "visible"
                        // If this part has auto-hide (hideAfter > 0), don't check its visibility
                        if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                            return true; // Temporary parts don't block navigation
                        }
                        const isVisible = part.visible;
                        if (!isVisible) {
                            console.log(`[Target 2] Slot ${slot}: Permanent part ${i} is not visible yet`);
                        }
                        return isVisible; // Permanent parts must be visible
                    });
                    if (result) {
                        console.log(`✅ [Target 2] Slot ${slot}: All permanent parts are visible! Navigation enabled.`);
                        if (onComplete && !this.completed && this.started && allLoaded >= files.length) {
                            this.completed = true;
                            try {
                                onComplete(slot);
                            } catch (err) {
                                console.error(`[Second Target Composite] onComplete callback for slot ${slot} failed:`, err);
                            }
                        }
                    }
                    return result;
                },
                completed: false
            };

            files.forEach((path, i) => {
                console.log(`[Second Target] Loading composite part ${i}: ${path}`);
                loader.load(
                    path, 
                    (gltf) => {
                        console.log(`[Second Target] Loaded part ${i}: ${path}`);
                        const root = gltf.scene;
                        root.visible = false;
                        root.position.set(0,0,0);
                        root.rotation.set(0,0,0);
                        root.userData = root.userData || {};
                        root.userData.clips = Array.isArray(gltf.animations) ? gltf.animations : [];
                        prepContent(root);
                        group.add(root);
                        parts[i] = root;

                        allLoaded++;
                        console.log(`[Second Target] Part ${i} loaded. Total loaded: ${allLoaded}/${files.length}`);
                        
                        // If target is already found and this is the current slot, try to start sequence
                        if (secondModels[slot] === group && secondIndex === slot && secondTargetFound) {
                            console.log(`[Second Target] Target already found, checking if sequence can start...`);
                            secondSlotControllers[slot].startSequenceIfReady();
                        }
                        
                        // If all parts are loaded and target is found, ensure sequence starts
                        if (allLoaded >= files.length && secondTargetFound && secondIndex === slot) {
                            console.log(`[Second Target] All parts loaded and target found - ensuring sequence starts`);
                            if (secondSlotControllers[slot] && !secondSlotControllers[slot].started) {
                                secondSlotControllers[slot].startSequenceIfReady();
                            }
                        }
                    },
                    undefined,
                    (error) => {
                        console.error(`[Second Target] Failed to load part ${i}: ${path}`, error);
                        // Continue even if one part fails - mark as "loaded" to prevent blocking
                        allLoaded++;
                        // If this was the last part and target is found, still try to start sequence
                        if (allLoaded >= files.length && secondTargetFound && secondIndex === slot) {
                            console.log(`[Second Target] All parts processed (some may have failed) - checking sequence`);
                            if (secondSlotControllers[slot] && !secondSlotControllers[slot].started) {
                                secondSlotControllers[slot].startSequenceIfReady();
                            }
                        }
                    }
                );
            });
        }

        // --- Slots (TOTAL = 3) ---
        

        // Slot 1: COMPOSITE of three files, revealed 3s apart (accumulating)

        // ============ LOAD SCENES ============
        // Scene 1: Single model


        loadComposite(0, [
            
            //gunes
            "./assets/DataModel11_3/Sahne1.1/gunes.gltf",   
            //mevcut
            "./assets/DataModel11_3/Sahne1.1/Bina.gltf",    
            "./assets/DataModel11_3/Sahne1.1/Binakapanacak1.gltf",   
            "./assets/DataModel11_3/Sahne1.1/Binakapanacak2.gltf",           
            //soru
            "./assets/DataModel11_3/Sahne1.1/Soru1.1.gltf",  
            "./assets/DataModel11_3/Sahne1.1/Soru1.2.gltf", 
            "./assets/DataModel11_3/Sahne1.1/Soru1.3.gltf", 
            "./assets/DataModel11_3/Sahne1.1/Soru1.4.gltf",  

            //enerji işaret
            "./assets/DataModel11_3/Sahne1.3/Simsek1.gltf", 
            //Enerji işaret azalma            
            "./assets/DataModel11_3/Sahne1.3/Simsek1ghost.gltf",            
            "./assets/DataModel11_3/Sahne1.3/Simsek2.gltf", 
            //sahne1.2
            //ışık yanması
            "./assets/DataModel11_3/Sahne1.2/Pencere1.gltf", 
            "./assets/DataModel11_3/Sahne1.2/Pencere2.gltf",    
            "./assets/DataModel11_3/Sahne1.2/Pencere3.gltf",    
            "./assets/DataModel11_3/Sahne1.2/Pencere4.gltf",    
            "./assets/DataModel11_3/Sahne1.2/Pencere5.gltf",    
            "./assets/DataModel11_3/Sahne1.2/Pencere6.gltf",    
                     
            "./assets/DataModel11_3/Sahne1.3/BarV2-8.gltf",  
            "./assets/DataModel11_3/Sahne1.3/BarV2-9.gltf",          
            "./assets/DataModel11_3/Sahne1.3/BarV2-10.gltf",          
            "./assets/DataModel11_3/Sahne1.3/BarV2-11.gltf",
            //Enerji işaret azalma            
            "./assets/DataModel11_3/Sahne1.3/Simsek3.gltf", 
            "./assets/DataModel11_3/Sahne1.3/Simsek3ghost.gltf", 
            "./assets/DataModel11_3/Sahne1.3/Simsek4.gltf", 

            //sahne1.4
            "./assets/DataModel11_3/Sahne1.4/arkaplan.gltf",              
            "./assets/DataModel11_3/Sahne1.4/Pencere1.gltf",  
            "./assets/DataModel11_3/Sahne1.4/Pencere2.gltf",                   

        ],  [0, 0, 0, 0,
            1000, 1250, 1500, 1750,
            3000, 4000, 4000,
            4000, 4250, 4500, 4750, 5000, 5250,
            6000, 6500, 8500, 8833,
            6500, 9000, 9000,
            9000, 9500, 10000], 
            
            [0, 0, 0, 0,
            0,0,0,0,
            1000, 2500, 2500,
            0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 
            2500, 0, 0,
            0, 0, 0,], {

            exclusive: false,
            resetOnLeave: true,
            resetOnEnter: true
        });

        loadComposite(1, [
            //sahne2.1 mevcut           
            "./assets/DataModel11_3/Sahne2.1/mevcut.gltf",
            //gunes
            "./assets/DataModel11_3/Sahne2.1/gunes.gltf",   
            //soru
            "./assets/DataModel11_3/Sahne2.1/Soru1.1.gltf",  
            "./assets/DataModel11_3/Sahne2.1/Soru1.2.gltf", 
            "./assets/DataModel11_3/Sahne1.1/Soru1.2.gltf", 
            "./assets/DataModel11_3/Sahne1.1/Soru1.3.gltf", 
            "./assets/DataModel11_3/Sahne2.1/Soru1.5.gltf",  

            //elektrik üretim
            "./assets/DataModel11_3/Sahne2.3/Simsek1.gltf",

            //sahne2.1 kapanacak binalar
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup1.gltf",  
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup2.gltf", 
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup3.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup4.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup5.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup6.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup7.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup8.gltf",
            "./assets/DataModel11_3/Sahne2.1/kapanacak/BinaGrup9.gltf",
            //sahne2.2 açılacak binalar
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup1.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup2.gltf",     
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup3.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup4.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup5.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup6.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup7.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup8.gltf",
            "./assets/DataModel11_3/Sahne2.2/acilacakbina/BinaGrup9.gltf",

            "./assets/DataModel11_3/Sahne2.2/sayilar/arkaplan.gltf",           
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi1.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi2.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi3.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi4.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi5.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi6.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi7.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi8.gltf",
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi9.gltf",

            "./assets/DataModel11_3/Sahne2.3/Simsek1ghost.gltf",
            "./assets/DataModel11_3/Sahne2.3/Simsek2.gltf",            

            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere1.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere2.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere3.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere4.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere5.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere6.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere7.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere8.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere9.gltf",
            "./assets/DataModel11_3/Sahne2.2/MevcutPencere/Pencere10.gltf",

            "./assets/DataModel11_3/Sahne2.3/BarV2-8.gltf",
            "./assets/DataModel11_3/Sahne2.3/BarV2-9.gltf",        
            "./assets/DataModel11_3/Sahne2.3/BarV2-10.gltf",
            "./assets/DataModel11_3/Sahne2.3/BarV2-11.gltf",

            "./assets/DataModel11_3/Sahne2.3/Simsek3.gltf",
            "./assets/DataModel11_3/Sahne2.3/Simsek3ghost.gltf",
            "./assets/DataModel11_3/Sahne2.3/Simsek4.gltf",

            "./assets/DataModel11_3/Sahne2.3/arkaplan.gltf",
            "./assets/DataModel11_3/Sahne2.3/Pencere/Penceregrup1.gltf",
            "./assets/DataModel11_3/Sahne2.3/Pencere/Penceregrup2.gltf",
            "./assets/DataModel11_3/Sahne2.3/Pencere/Penceregrup3.gltf",
            "./assets/DataModel11_3/Sahne2.3/Pencere/Penceregrup4.gltf",
            "./assets/DataModel11_3/Sahne2.3/Pencere/Penceregrup5.gltf",
        ], 
        
        // Timing array - when each part appears
        [   0,  //mevcut
            0, //gunes
            1000, 1250, 1500, 1750, 2000,//soru
            4000, // elektrik üretim
            0, 0, 0, 0, 0, 0, 0, 0, 0,//kapanacakbina
            4000, 4250, 4500, 4750, 5000, 5250, 5500, 5750, 6000, //açılacakbina
            4000, 4000, 4250, 4500, 4750, 5000, 5250, 5500, 5750, 6000,
            7000,7000, //kullanılan enerji
            7000, 7250, 7500, 7750, 8000, 8250, 8500, 8750, 9000, 9250,//mevcutpencere
            10000, 10250, 12250, 12500,
            10500, 13000, 13000,
            13000, 13000, 13250, 13500, 13750, 14000,
        ], 
        
        // HideAfter array - how long each part stays (0 = forever)
        [   0,  //mevcut
            0, //gunes
            0, 0, 0, 0, 0,
            3000,
            4000, 4250, 4500, 4750, 5000, 5250, 5500, 5750, 6000,
            0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 250, 250, 250, 250, 250, 250, 250, 250, 0,
            3500, 3500,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0,
            2500, 0, 0,
            0, 0, 0, 0, 0, 0,
        ], {

            exclusive: false,
            resetOnLeave: true,
            resetOnEnter: true
        });

        loadComposite(2, [
            //gunes
            "./assets/DataModel11_3/Sahne3.1/gunes.gltf", 

            "./assets/DataModel11_3/Sahne3.1/Soru1.1.gltf",   
            "./assets/DataModel11_3/Sahne1.1/Soru1.2.gltf", 
            "./assets/DataModel11_3/Sahne1.1/Soru1.3.gltf",  
            "./assets/DataModel11_3/Sahne3.1/Soru1.4.gltf",  

            "./assets/DataModel11_3/Sahne3.1/Binamevcut.gltf",  
            "./assets/DataModel11_3/Sahne2.2/sayilar/arkaplan.gltf",   
            "./assets/DataModel11_3/Sahne2.2/sayilar/sayi9.gltf",         


            "./assets/DataModel11_3/Sahne3.4/Simsek1.gltf",    

            "./assets/DataModel11_3/Sahne3.1/Kapanacak/BinaGrup1.gltf",
            "./assets/DataModel11_3/Sahne3.1/Kapanacak/BinaGrup2.gltf",
            "./assets/DataModel11_3/Sahne3.1/Kapanacak/BinaGrup3.gltf",
            "./assets/DataModel11_3/Sahne3.1/Kapanacak/BinaGrup4.gltf",
            "./assets/DataModel11_3/Sahne3.1/Kapanacak/BinaGrup5.gltf",

            "./assets/DataModel11_3/Sahne3.2/Acilacak/BinaGrup1.gltf",           
            "./assets/DataModel11_3/Sahne3.2/Acilacak/BinaGrup2.gltf",
            "./assets/DataModel11_3/Sahne3.2/Acilacak/BinaGrup3.gltf",
            "./assets/DataModel11_3/Sahne3.2/Acilacak/BinaGrup4.gltf",
            "./assets/DataModel11_3/Sahne3.2/Acilacak/BinaGrup5.gltf",

            "./assets/DataModel11_3/Sahne3.2/sayilar/sayi1.gltf",            
            "./assets/DataModel11_3/Sahne3.2/sayilar/sayi2.gltf",            
            "./assets/DataModel11_3/Sahne3.2/sayilar/sayi3.gltf",            
            "./assets/DataModel11_3/Sahne3.2/sayilar/sayi4.gltf",            
            "./assets/DataModel11_3/Sahne3.2/sayilar/sayi5.gltf",   

            "./assets/DataModel11_3/Sahne3.4/Simsek1ghost.gltf",  
            "./assets/DataModel11_3/Sahne3.4/Simsek2.gltf",

            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup1.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup2.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup3.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup4.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup5.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup6.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup7.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup8.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup9.gltf",
            "./assets/DataModel11_3/Sahne3.2/Pencere/PencereGrup10.gltf",


            "./assets/DataModel11_3/Sahne3.4/Bar1.gltf",   
            "./assets/DataModel11_3/Sahne3.4/Bar2.gltf",
            "./assets/DataModel11_3/Sahne3.4/Ok.gltf",
            "./assets/DataModel11_3/Sahne3.4/Bar3.gltf",
            "./assets/DataModel11_3/Sahne3.4/Bar4.gltf",
            "./assets/DataModel11_3/Sahne3.4/Bar5.gltf",

            "./assets/DataModel11_3/Sahne3.4/Simsek3.gltf",

            "./assets/DataModel11_3/Sahne3.4/barseffaf.gltf", 
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",
            "./assets/DataModel11_3/Sahne3.4/barseffaf.gltf", 
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",
            "./assets/DataModel11_3/Sahne3.4/barseffaf.gltf", 
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",
            "./assets/DataModel11_3/Sahne3.4/barseffaf.gltf", 
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",
            "./assets/DataModel11_3/Sahne3.4/barseffaf.gltf", 
            "./assets/DataModel11_3/Sahne3.4/baryanson.gltf",


              
        ], [0,
            1000, 1250, 1500, 1750,
            0, 0, 0,
            4000,
            0, 0, 0, 0, 0, 
            4000, 4250, 4500, 4750, 5000,
            4000, 4250, 4500, 4750, 5000,
            6000, 6000,
            6000, 6250, 6500, 6750, 7000, 7250, 7500, 7750, 8000, 8250,
            9000, 9250, 9375, 10750, 11833, 13000,
            9500,
            14000, 14000, 14500, 14500, 15000, 15000, 15500, 15500, 16000, 16000,


            ],

            [0,
            0, 0, 0, 0,
            0, 0, 4000,
            2000,   
            4000, 4500, 5000, 5500, 6000, 
            0, 0, 0, 0, 0, 
            250, 250, 250, 250, 0,
            3500, 3500,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            5000, 4750, 4245, 3250, 2177, 1000,
            4500,
            250, 250, 250, 250, 250, 250, 250, 250, 0, 0,

            ], {

            exclusive: false,
            resetOnLeave: true,
            resetOnEnter: true,
            onComplete: handleFirstTargetCompletion
        });

        // ============ SECOND TARGET NAVIGATION ============
        // Navigation functions for second target (similar to first target)
        function secondApplyVisibility() {
            if (!secondTargetActive) {
                // Ensure second target content stays hidden without disrupting first target scenes
                secondModels.forEach(m => { if (m) m.visible = false; });
                return;
            }
            // Hide all first target models when on second target
            models.forEach(m => { if (m) m.visible = false; });
            
            // Show only current second target scene
            secondModels.forEach((m, i) => { 
                if (m) {
                    m.visible = (i === secondIndex);
                    console.log(`[Target 2] Setting model ${i} visibility to ${m.visible} (current index: ${secondIndex})`);
                    // Ensure the group itself is visible if it should be shown
                    if (i === secondIndex && m.visible) {
                        console.log(`[Target 2] Model ${i} is visible, checking children count:`, m.children.length);
                    }
                }
            });
            
            // fire leave/enter once per slot change
            if (secondLastActive !== secondIndex) {
                if (secondLastActive >= 0 && secondSlotControllers[secondLastActive]?.onLeave) {
                    secondSlotControllers[secondLastActive].onLeave();
                }
                if (secondSlotControllers[secondIndex]?.onEnter) {
                    console.log(`[Target 2] Calling onEnter for slot ${secondIndex}`);
                    secondSlotControllers[secondIndex].onEnter();
                } else {
                    console.warn(`[Target 2] No controller found for slot ${secondIndex}`);
                }
                
                secondLastActive = secondIndex;
            }
            
            secondUpdateLabel();
            secondUpdateNavigationButtons();
        }
        
        function secondNextLoaded(from, dir) {
            let i = from;
            for (let step = 0; step < SECOND_TOTAL; step++) {
                i = (i + dir + SECOND_TOTAL) % SECOND_TOTAL;
                if (secondModels[i]) return i;
            }
            return from;
        }
        
        function secondShowDelta(delta) {
            if (secondCountLoaded() === 0) return;
            console.log(`[Target 2] Navigating from scene ${secondIndex} with delta ${delta}`);
            secondIndex = secondNextLoaded(secondIndex, delta >= 0 ? +1 : -1);
            console.log(`[Target 2] Now on scene ${secondIndex}`);
            secondApplyVisibility();
        }
        
        // Replay current second target scene function
        function replaySecondTargetScene() {
            // If we're awaiting the third target, hide the prompt and reset the flag so it can appear again
            if (awaitingThirdTarget) {
                console.log('Replay clicked while awaiting third target - hiding prompt and replaying...');
                hideThirdTargetPrompt();
                thirdTargetPromptShown = false; // Reset flag so prompt can appear again after replay
                clearTimeout(thirdTargetPromptDelayTimer);
                awaitingThirdTarget = false;
                // Reactivate the content for replay
                secondTargetFound = true;
                secondTargetActive = true;
                showSecondTargetOccluders();
                // Show navigation buttons (prev button should be visible if not on first scene)
                showNavigationArrows();
                // Make sure the current scene is visible
                secondApplyVisibility();
            }
            
            console.log(`Replaying second target scene ${secondIndex}...`);
            const controller = secondSlotControllers[secondIndex];
            if (controller && controller.isComposite) {
                // Reset and restart the composite sequence
                controller.onLeave(); // Clean up current state
                controller.onEnter(); // Restart sequence
                console.log(`Second target scene ${secondIndex} replay initiated`);
            } else {
                console.log(`Second target scene ${secondIndex} is not a composite scene, no replay needed`);
            }
        }
        
        function secondUpdateLabel() {
            label.textContent = `Part 2 - ${secondIndex + 1}/${SECOND_TOTAL}`;
        }
        
        function secondUpdateNavigationButtons() {
            const currentSlot = secondSlotControllers[secondIndex];
            const loadedCount = secondCountLoaded();
            
            // If only one scene, only show replay button
            if (SECOND_TOTAL === 1) {
                hidePrevButton();
                hideNextButton();
                return;
            }
            
            // Check if we can go to previous scene
            const canGoPrev = secondIndex > 0;
            if (canGoPrev) {
                showPrevButton();
                prevB.disabled = false;
                prevB.style.opacity = '1';
            } else {
                hidePrevButton();
            }
            
            // Check if there's a next scene available
            const hasNextScene = secondIndex < loadedCount - 1;
            
            // Check if current scene is completed (all parts visible for composite scenes)
            let sceneCompleted = false;
            if (currentSlot && currentSlot.isComposite) {
                sceneCompleted = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
            } else {
                sceneCompleted = true; // For regular slots, consider completed immediately
            }
            
            // Handle next button visibility and state
            if (secondIndex === SECOND_TOTAL - 1) {
                // On last scene - hide next button
                hideNextButton();
            } else if (hasNextScene) {
                // There's a next scene - always show next button
                showNextButton();
                if (sceneCompleted) {
                    // Scene completed - active next button
                    nextB.disabled = false;
                    nextB.style.opacity = '1';
                } else {
                    // Scene not completed - inactive next button at 50% opacity
                    nextB.disabled = true;
                    nextB.style.opacity = '0.5';
                }
            } else {
                // No next scene - hide next button
                hideNextButton();
            }
            
            // Update info button state for second target (same logic as next button)
            let canShowInfo = false;
            if (currentSlot && currentSlot.isComposite) {
                const allPartsVisible = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
                canShowInfo = allPartsVisible;
            } else {
                canShowInfo = true; // For regular slots, always allow info
            }
            
            infoB.disabled = !canShowInfo;
            infoB.style.opacity = canShowInfo ? '1' : '0.5';
        }

        // ============ SECOND TARGET HANDLERS (Middle Target) ============
        // Initialize second anchor and its event handlers (created when needed)
        function initializeSecondAnchor() {
            if (secondAnchorInitialized) return; // Already initialized
            
            console.log('Creating second anchor (middle target) for tracking...');
            secondAnchor = mindarThree.addAnchor(1); // Create second target anchor (index 1)
            secondAnchorInitialized = true;
            
            // Create second smoothed group for second target (at scene level)
            secondSmoothed = new THREE.Group();
            secondSmoothed.name = 'second-smoothed-group';
            secondSmoothed.visible = true; // Ensure it's visible
            scene.add(secondSmoothed); // Add to scene for independent interpolation
            console.log('[Target 2] Created secondSmoothed group and added to scene');
            console.log('[Target 2] secondSmoothed in scene:', scene.children.includes(secondSmoothed));
            
            // Load occluders for second target
            loadSecondTargetOccluders();

            // Set up event handlers for second target
            setupSecondTargetHandlers();
            
            // Load second target scenes
            loadSecondTargetScenes();
        }
        
        // Set up event handlers for second target
        function setupSecondTargetHandlers() {
            secondAnchor.onTargetFound = () => {
                if (firstTargetCurrentlyTracked || thirdTargetActive) {
                    console.log('Second target detected while another target is active. Ignoring to avoid overlap.');
                    return;
                }
                // Only activate if first target scenes are completed
                if (!allScenesCompleted) {
                    console.log('Second target found but first target scenes not completed yet.');
                    showNotReadyMessage();
                    return;
                }
                
                console.log('🎯 Second target found! Showing scenes...');
                console.log('[Debug] Activating Target 2, current scene:', secondIndex);
                console.log('[Debug] Second target model exists:', !!secondModels[secondIndex]);
                console.log('[Debug] Second target controller exists:', !!secondSlotControllers[secondIndex]);
                hideSecondTargetPrompt();
                hideSecondTargetArrow();
                showNavigationArrows();
                showReplayButton();
                showInfoButton();
                
                // Hide all other targets' models
                models.forEach(m => { if (m) m.visible = false; });
                
                // Hide first target occluders (they only apply to first target)
                hideFirstTargetOccluders();
                // Show second target occluders
                showSecondTargetOccluders();
                
                // Initialize second smoothed group position on first detection to prevent initial snap
                if (!secondTargetFound && secondSmoothed) {
                    secondAnchor.group.getWorldPosition(secondSmoothed.position);
                    secondAnchor.group.getWorldQuaternion(secondSmoothed.quaternion);
                    secondAnchor.group.getWorldScale(secondSmoothed.scale);
                }
                
                secondTargetActive = true;
                secondTargetFound = true;
                awaitingSecondTarget = false;
                // Show HUD for navigation
                hud.hidden = false;
                secondUpdateLabel();
                secondUpdateNavigationButtons();
                
                // Show content first (this will call secondApplyVisibility)
                showSecondTargetContent();
                
                // Trigger composite sequence if on composite slot
                // Use a small delay to ensure models have a chance to load if they're still loading
                if (secondSlotControllers[secondIndex] && secondSlotControllers[secondIndex].isComposite) {
                    console.log(`[Target 2] Attempting to start composite sequence for slot ${secondIndex}`);
                    // Try immediately
                    secondSlotControllers[secondIndex].startSequenceIfReady();
                    
                    // Also set up a retry mechanism in case models are still loading
                    // This handles the case where target is found before all models are loaded
                    let retryCount = 0;
                    const maxRetries = 10;
                    const retryInterval = setInterval(() => {
                        retryCount++;
                        if (secondSlotControllers[secondIndex] && !secondSlotControllers[secondIndex].started) {
                            console.log(`[Target 2] Retry ${retryCount}: Attempting to start sequence...`);
                            secondSlotControllers[secondIndex].startSequenceIfReady();
                            
                            // If sequence started or we've tried enough times, stop retrying
                            if (secondSlotControllers[secondIndex].started || retryCount >= maxRetries) {
                                clearInterval(retryInterval);
                                if (secondSlotControllers[secondIndex].started) {
                                    console.log(`[Target 2] Sequence started successfully after ${retryCount} retries`);
                                } else {
                                    console.warn(`[Target 2] Sequence failed to start after ${maxRetries} retries`);
                                }
                            }
                        } else {
                            clearInterval(retryInterval);
                        }
                    }, 500); // Check every 500ms
                } else {
                    console.log(`[Target 2] Slot ${secondIndex} is not a composite slot or controller doesn't exist`);
                }
            };
            
            secondAnchor.onTargetLost = () => {
                if (secondTargetActive) {
                    console.log('⚠️ Second target tracking lost! Deactivating second target.');
                    console.log('[Debug] Current states - Target1:', targetFound, 'Target2:', secondTargetFound);
                    secondTargetActive = false;
                    secondTargetFound = false;
                    hideSecondTargetPrompt();
                    // Always hide second target occluders on loss
                    hideSecondTargetOccluders();
                    // Only hide HUD if no other target is active
                    if (!targetFound) {
                        hud.hidden = true;
                        console.log('[Debug] HUD hidden - no active targets');
                    }
                    hideSecondTargetContent();
                    hideReplayButton();
                    showSecondTargetPrompt();
                    showSecondTargetArrow();
                    hideNavigationArrows();
                    if (targetFound) {
                        showNavigationArrows();
                        showInfoButton();
                    } else {
                        hideNavigationArrows();
                        hideInfoButton();
                    }
                awaitingSecondTarget = true;
                }
            };
        }
        
        // Load all second target scenes
        function loadSecondTargetScenes() {
            console.log('Loading second target (middle) scenes...');
            
            // Second Target Scene 1 - Composite scene
            secondLoadComposite(0, [
                "./assets/DataModel11_3/Franz/Sahne1/gunes.gltf", 
                "./assets/DataModel11_3/Franz/Sahne1/binaisikmevcut.gltf", 

                "./assets/DataModel11_3/Franz/Bar/Barsabit.gltf",
                "./assets/DataModel11_3/Franz/Bar/Bar2.gltf",  
                "./assets/DataModel11_3/Franz/Bar/Ok.gltf",  
                "./assets/DataModel11_3/Franz/Bar/Bar3.gltf",  
                "./assets/DataModel11_3/Franz/Bar/simsek.gltf", 
                "./assets/DataModel11_3/Franz/Bar/simsekghost.gltf", 

                "./assets/DataModel11_3/Franz/Sahne1/arkaplansurplus.gltf",
                "./assets/DataModel11_3/Franz/Sahne1/isiksurplus1.gltf",
                "./assets/DataModel11_3/Franz/Sahne1/isiksurplus2.gltf",
                "./assets/DataModel11_3/Franz/Sahne1/isiksurplus3.gltf",
                "./assets/DataModel11_3/Franz/Sahne1/isiksurplus4.gltf",
                "./assets/DataModel11_3/Franz/Sahne1/isiksurplus5.gltf",     
                
                "./assets/DataModel11_3/Franz/Sahne1/yazison1.gltf", 
                "./assets/DataModel11_3/Franz/Sahne1/yazison2.gltf", 

                

            ], 
            [0, 0, 250, 250, 250, 2133, 250, 3250, 3250, 3500, 3750, 4000, 4250, 4500, 5250, 5500,],     // Timing
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,]);   

            // Second Target Scene 2 - Follow-up composite scene
            secondLoadComposite(1, [
                "./assets/DataModel11_3/Franz/Sahne1/gunes.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/binakapanacak1.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binakapanacak2.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binakapanacak3.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binakapanacak4.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binakapanacak5.gltf",  

                "./assets/DataModel11_3/Franz/Sahne2/yazi1.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/yazi2.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/yazi3.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/yazi4.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/Simsek2.gltf",                  
                "./assets/DataModel11_3/Franz/Sahne2/binaacilacak1.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binaacilacak2.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binaacilacak3.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binaacilacak4.gltf",                
                "./assets/DataModel11_3/Franz/Sahne2/binaacilacak5.gltf",   
                "./assets/DataModel11_3/Franz/Sahne2/sayi2.gltf",  
                "./assets/DataModel11_3/Franz/Sahne2/sayi3.gltf",  
                "./assets/DataModel11_3/Franz/Sahne2/sayi4.gltf",  
                "./assets/DataModel11_3/Franz/Sahne2/sayi5.gltf",  
                "./assets/DataModel11_3/Franz/Sahne2/sayi6.gltf",  
                "./assets/DataModel11_3/Franz/Sahne2/arkaplan.gltf",
                "./assets/DataModel11_3/Franz/Sahne2/Simsek2ghost.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/Simsek3.gltf", 
                "./assets/DataModel11_3/Franz/Sahne2/isik4.gltf",
                "./assets/DataModel11_3/Franz/Sahne2/isik1.gltf",                         
                "./assets/DataModel11_3/Franz/Sahne2/isik2.gltf",                         
                "./assets/DataModel11_3/Franz/Sahne2/isik3.gltf",
                "./assets/DataModel11_3/Franz/Sahne2/yazison.gltf",

            ],
            [0, 0, 0, 0, 0, 0,
                1000, 1250, 1500, 1750, 2500, 2500, 2750, 3000, 3250, 3500, 2500, 2750, 3000, 3250, 3500, 5000, 5250, 5250, 5250, 5500, 5750, 6000, 6250,], 
            [0, 3000, 3250, 3500, 3750, 4000,
                0, 0, 0, 0, 2750, 0, 0, 0, 0, 0, 250, 250, 250, 250, 0, 0, 0, 0, 0, 0, 0, 0, 0, ], 
            {
                exclusive: false,
                resetOnLeave: true,
                resetOnEnter: true,
                onComplete: handleSecondTargetCompletion
            });
        }
        
        function handleSecondTargetCompletion() {
            if (thirdTargetPromptShown) return;
            thirdTargetPromptShown = true;
            secondTargetScenesCompleted = true;
            console.log('✅ All second target scenes complete. Prompting user to move to the third target.');
            clearTimeout(thirdTargetPromptDelayTimer);
            thirdTargetPromptDelayTimer = setTimeout(() => {
                awaitingThirdTarget = true;
                deactivateSecondTargetContent();
                showThirdTargetPrompt();
                // Hide next button (we're on last scene)
                hideNextButton();
                // Keep prev and replay buttons visible so users can navigate back or replay
                showPrevButton();
                // Keep replay button visible so users can replay the scene
                // hideReplayButton();
                hideInfoButton();
                secondTargetFound = false;
            }, 2000);
            if (!thirdAnchorInitialized) {
                initializeThirdAnchor();
            }
        }
        
        function deactivateSecondTargetContent() {
            console.log('[Target 2] Deactivating current content.');
            secondModels.forEach((m, i) => {
                if (m) {
                    m.visible = false;
                }
                if (secondSlotControllers[i]?.onLeave) {
                    try {
                        secondSlotControllers[i].onLeave();
                    } catch (err) {
                        console.error(`[Target 2] Error during onLeave for slot ${i}:`, err);
                    }
                }
            });
            hideSecondTargetOccluders();
            secondTargetFound = false;
            secondTargetActive = false;
        }
        
        // Show content for second target
        function showSecondTargetContent() {
            console.log('Displaying second target composite scenes...');
            console.log('[Target 2] Current scene index:', secondIndex);
            console.log('[Target 2] Scene model exists:', !!secondModels[secondIndex]);
            // Ensure first target models are hidden
            models.forEach(m => { if (m) m.visible = false; });
            // Show the current scene on second target
            secondApplyVisibility();
        }
        
        // Hide second target content
        function hideSecondTargetContent() {
            console.log('Hiding second target content...');
            // Hide all second target models
            secondModels.forEach(m => { if (m) m.visible = false; });
        }
        
        // ============ THIRD TARGET HANDLERS ============
        // Initialize third anchor and its event handlers (created when needed)
        function initializeThirdAnchor() {
            if (thirdAnchorInitialized) return; // Already initialized
            
            console.log('Creating third anchor for tracking...');
            thirdAnchor = mindarThree.addAnchor(2); // Create third target anchor (index 2)
            thirdAnchorInitialized = true;
            
            // Create third smoothed group for third target (at scene level)
            thirdSmoothed = new THREE.Group();
            thirdSmoothed.name = 'third-smoothed-group';
            thirdSmoothed.visible = true;
            scene.add(thirdSmoothed);
            console.log('[Target 3] Created thirdSmoothed group and added to scene');
            
            // Set up event handlers for third target
            setupThirdTargetHandlers();
            
            // Load third target scenes
            loadThirdTargetScenes();
        }
        
        // Set up event handlers for third target
        function setupThirdTargetHandlers() {
            thirdAnchor.onTargetFound = () => {
                if (firstTargetCurrentlyTracked || secondTargetActive) {
                    console.log('Third target detected while another target is active. Ignoring to avoid overlap.');
                    return;
                }
                // Only activate if second target scenes are completed
                if (!secondTargetScenesCompleted) {
                    console.log('Third target found but second target scenes not completed yet.');
                    return;
                }
                
                console.log('🎯 Third target found! Showing scene...');
                hideThirdTargetPrompt();
                showNavigationArrows();
                showReplayButton();
                showInfoButton();
                
                // Hide all other targets' models
                models.forEach(m => { if (m) m.visible = false; });
                secondModels.forEach(m => { if (m) m.visible = false; });
                
                // Hide other targets' occluders
                hideFirstTargetOccluders();
                hideSecondTargetOccluders();
                
                // Initialize third smoothed group position on first detection
                if (!thirdTargetFound && thirdSmoothed) {
                    thirdAnchor.group.getWorldPosition(thirdSmoothed.position);
                    thirdAnchor.group.getWorldQuaternion(thirdSmoothed.quaternion);
                    thirdAnchor.group.getWorldScale(thirdSmoothed.scale);
                }
                
                thirdTargetActive = true;
                thirdTargetFound = true;
                awaitingThirdTarget = false;
                hud.hidden = false;
                thirdUpdateLabel();
                thirdUpdateNavigationButtons();
                
                // Show content
                showThirdTargetContent();
                
                // Trigger composite sequence if on composite slot
                if (thirdSlotControllers[thirdIndex] && thirdSlotControllers[thirdIndex].isComposite) {
                    console.log(`[Target 3] Attempting to start composite sequence for slot ${thirdIndex}`);
                    thirdSlotControllers[thirdIndex].startSequenceIfReady();
                }
            };
            
            thirdAnchor.onTargetLost = () => {
                if (thirdTargetActive) {
                    console.log('⚠️ Third target tracking lost!');
                    thirdTargetActive = false;
                    thirdTargetFound = false;
                    hideThirdTargetPrompt();
                    if (!targetFound && !secondTargetFound) {
                        hud.hidden = true;
                    }
                    hideThirdTargetContent();
                }
            };
        }
        
        // Load third target scenes
        function loadThirdTargetScenes() {
            console.log('Loading third target scenes...');

            // === PLACEHOLDER SCENES FOR THIRD TARGET ===
            // Replace the file paths below with your actual GLTFs.
            // Timing array: when each part appears (ms). HideAfter: 0 = stays visible.

            // Scene 1 (index 0): simple two-part reveal
            thirdLoadComposite(
                0,
                [
                    "./assets/DataModel11_3/BinaKale/Because.gltf", 
                    "./assets/DataModel11_3/BinaKale/mevcut.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1SimsekHayalet.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Simsek.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac1.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac2.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac3.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac4.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac5.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1Ac6.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina1yuzde.gltf",  

                    "./assets/DataModel11_3/BinaKale/Bina2SimsekHayalet.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Simsek.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac1.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac2.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac3.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac4.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac5.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac6.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2Ac7.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina2yuzde.gltf", 

                    "./assets/DataModel11_3/BinaKale/Bina3SimsekHayalet.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Simsek.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac1.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac2.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac3.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac4.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac5.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3Ac6.gltf", 
                    "./assets/DataModel11_3/BinaKale/Bina3yuzde.gltf", 


                ],
                [0, 0, 0, 0, 1150, 1300, 1450, 1600, 1750, 1900, 2050, 
                    3500, 3500, 3500, 3650, 3800, 3950, 4100, 4250, 4400, 4550,
                    5000, 5000, 5000, 5150, 5300, 5450, 5600, 5750, 5900,

                ],
                [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ],
                { resetOnLeave: true, resetOnEnter: true, exclusive: false }
            );
        }
        
        // Third target navigation functions
        function thirdApplyVisibility() {
            if (!thirdTargetActive) {
                thirdModels.forEach(m => { if (m) m.visible = false; });
                return;
            }
            models.forEach(m => { if (m) m.visible = false; });
            secondModels.forEach(m => { if (m) m.visible = false; });
            
            thirdModels.forEach((m, i) => {
                if (m) {
                    m.visible = (i === thirdIndex);
                }
            });
            
            if (thirdLastActive !== thirdIndex) {
                if (thirdLastActive >= 0 && thirdSlotControllers[thirdLastActive]?.onLeave) {
                    thirdSlotControllers[thirdLastActive].onLeave();
                }
                if (thirdSlotControllers[thirdIndex]?.onEnter) {
                    thirdSlotControllers[thirdIndex].onEnter();
                }
                thirdLastActive = thirdIndex;
            }
            
            thirdUpdateLabel();
            thirdUpdateNavigationButtons();
        }
        
        function thirdUpdateLabel() {
            label.textContent = `Part 3 - ${thirdIndex + 1}/${THIRD_TOTAL}`;
        }
        
        function thirdUpdateNavigationButtons() {
            const currentSlot = thirdSlotControllers[thirdIndex];
            const loadedCount = thirdCountLoaded();
            
            // If only one scene, only show replay button
            if (THIRD_TOTAL === 1) {
                hidePrevButton();
                hideNextButton();
                return;
            }
            
            const canGoPrev = thirdIndex > 0;
            if (canGoPrev) {
                showPrevButton();
                prevB.disabled = false;
                prevB.style.opacity = '1';
            } else {
                hidePrevButton();
            }
            
            // Check if there's a next scene available
            const hasNextScene = thirdIndex < loadedCount - 1;
            
            // Check if current scene is completed (all parts visible for composite scenes)
            let sceneCompleted = false;
            if (currentSlot && currentSlot.isComposite) {
                sceneCompleted = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
            } else {
                sceneCompleted = true; // For regular slots, consider completed immediately
            }
            
            // Handle next button visibility and state
            if (thirdIndex === THIRD_TOTAL - 1) {
                // On last scene - hide next button
                hideNextButton();
            } else if (hasNextScene) {
                // There's a next scene - always show next button
                showNextButton();
                if (sceneCompleted) {
                    // Scene completed - active next button
                    nextB.disabled = false;
                    nextB.style.opacity = '1';
                } else {
                    // Scene not completed - inactive next button at 50% opacity
                    nextB.disabled = true;
                    nextB.style.opacity = '0.5';
                }
            } else {
                // No next scene - hide next button
                hideNextButton();
            }
            
            // Update info button state
            let canShowInfo = false;
            if (currentSlot && currentSlot.isComposite) {
                const allPartsVisible = currentSlot.areAllPartsVisible ? currentSlot.areAllPartsVisible() : true;
                canShowInfo = allPartsVisible;
            } else {
                canShowInfo = true;
            }
            
            infoB.disabled = !canShowInfo;
            infoB.style.opacity = canShowInfo ? '1' : '0.5';
        }
        
        function showThirdTargetContent() {
            console.log('Displaying third target scenes...');
            models.forEach(m => { if (m) m.visible = false; });
            secondModels.forEach(m => { if (m) m.visible = false; });
            thirdApplyVisibility();
        }
        
        function hideThirdTargetContent() {
            console.log('Hiding third target content...');
            thirdModels.forEach(m => { if (m) m.visible = false; });
        }
        
        // Third target register function
        function thirdRegister(obj, slot) {
            obj.visible = false;
            if (thirdSmoothed) {
                thirdSmoothed.add(obj);
                console.log(`[Target 3] Registered model for slot ${slot}, added to thirdSmoothed.`);
            } else {
                console.error(`[Target 3] ERROR: thirdSmoothed does not exist when trying to register slot ${slot}!`);
                scene.add(obj);
            }
            thirdModels[slot] = obj;
            thirdApplyVisibility();
        }
        
        // Third target load composite (similar to secondLoadComposite)
        function thirdLoadComposite(slot, files, timing, hideAfter, { resetOnLeave=true, exclusive=false, resetOnEnter=true } = {}) {
            console.log(`[Target 3] Loading composite slot ${slot} with ${files.length} files`);
            
            const group = new THREE.Group();
            group.name = `third-composite-slot-${slot}`;
            thirdRegister(group, slot);
            
            const parts = [];
            let timers = [];
            let allLoaded = 0;
            
            const clearTimers = () => { timers.forEach(id => clearTimeout(id)); timers = []; };
            
            function hidePart(i) {
                const p = parts[i];
                if (!p) return;
                p.visible = false;
                stopAnimationsForPart(p);
                thirdUpdateNavigationButtons();
            }
            
            function revealPart(i) {
                if (exclusive) {
                    parts.forEach((p, j) => {
                        if (p) {
                            p.visible = (j === i);
                            if (j !== i) stopAnimationsForPart(p);
                        }
                    });
                }
                const p = parts[i];
                if (!p) return;
                p.visible = true;
                startAnimationsForPart(p);
                if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                    const hideTimer = setTimeout(() => hidePart(i), hideAfter[i]);
                    timers.push(hideTimer);
                }
                thirdUpdateNavigationButtons();
            }
            
            function startAnimationsForPart(part) {
                const target = part;
                const clips = (target.userData && Array.isArray(target.userData.clips)) ? target.userData.clips : [];
                if (!clips.length) return;
                const mixer = new THREE.AnimationMixer(target);
                target.userData.mixers = target.userData.mixers || [];
                target.userData.mixers.push(mixer);
                clips.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.reset();
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    action.time = 0;
                    action.enabled = true;
                    action.setEffectiveWeight(1.0);
                    action.fadeIn(0);
                    action.play();
                });
            }
            
            function stopAnimationsForPart(part) {
                part.traverse((child) => {
                    if (child.userData.mixers) {
                        child.userData.mixers.forEach(mixer => mixer.stopAllAction());
                        child.userData.mixers = [];
                    }
                });
            }
            
            function startSequence() {
                if (thirdSlotControllers[slot].started) return;
                if (allLoaded < files.length) return;
                thirdSlotControllers[slot].started = true;
                clearTimers();
                const firstTime = (Array.isArray(timing) && timing.length > 0) ? (timing[0] || 0) : 0;
                files.forEach((_, i) => {
                    const absoluteTime = timing[i] || 0;
                    const relativeTime = Math.max(0, absoluteTime - firstTime);
                    const id = setTimeout(() => revealPart(i), relativeTime);
                    timers.push(id);
                });
            }
            
            function hideAllParts() {
                parts.forEach(p => {
                    if (p) {
                        p.visible = false;
                        stopAnimationsForPart(p);
                    }
                });
            }
            
            thirdSlotControllers[slot] = {
                isComposite: true,
                started: false,
                onEnter() {
                    models.forEach(m => { if (m) m.visible = false; });
                    secondModels.forEach(m => { if (m) m.visible = false; });
                    if (resetOnEnter) {
                        clearTimers();
                        hideAllParts();
                        this.started = false;
                    }
                    if (thirdTargetFound && allLoaded >= files.length) {
                        startSequence();
                        this.started = true;
                    }
                },
                onLeave() {
                    clearTimers();
                    if (resetOnLeave) { hideAllParts(); }
                    this.started = false;
                },
                startSequenceIfReady() {
                    if (thirdTargetFound && !this.started) {
                        if (allLoaded >= files.length) {
                            startSequence();
                            this.started = true;
                        }
                    }
                },
                areAllPartsVisible() {
                    if (files.length === 0) return true;
                    const result = parts.every((part, i) => {
                        if (!part) return true;
                        if (hideAfter && hideAfter[i] && hideAfter[i] > 0) {
                            return true;
                        }
                        return part.visible;
                    });
                    return result;
                }
            };
            
            files.forEach((path, i) => {
                loader.load(
                    path,
                    (gltf) => {
                        const root = gltf.scene;
                        root.visible = false;
                        root.position.set(0,0,0);
                        root.rotation.set(0,0,0);
                        root.userData = root.userData || {};
                        root.userData.clips = Array.isArray(gltf.animations) ? gltf.animations : [];
                        prepContent(root);
                        group.add(root);
                        parts[i] = root;
                        allLoaded++;
                        if (thirdModels[slot] === group && thirdIndex === slot && thirdTargetFound) {
                            thirdSlotControllers[slot].startSequenceIfReady();
                        }
                    },
                    undefined,
                    (error) => {
                        console.error(`[Third Target] Failed to load part ${i}: ${path}`, error);
                        allLoaded++;
                    }
                );
            });
        }
        
        // Show message when targets found but not ready
        function showNotReadyMessage() {
            const message = document.createElement('div');
            message.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(255, 165, 0, 0.9);
                color: white;
                padding: 20px;
                border-radius: 8px;
                font-family: system-ui;
                font-size: 16px;
                text-align: center;
                z-index: 10000;
            `;
            message.innerHTML = `
                <p>⚠️ Complete the first target first!</p>
                <p>Scan the first target and complete all scenes.</p>
            `;
            document.body.appendChild(message);
            
            setTimeout(() => {
                if (message.parentNode) {
                    message.parentNode.removeChild(message);
                }
            }, 3000);
        }

        // Create text sprite for AR instructions (shared by second target guide)
        function createTextSprite(text, parentGroup) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 512;
            canvas.height = 256;
            
            // Draw text
            context.fillStyle = 'rgba(0, 0, 0, 0.8)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            
            context.font = 'bold 40px Arial';
            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            
            // Split text by newlines and draw each line
            const lines = text.split('\n');
            const lineHeight = 50;
            const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;
            
            lines.forEach((line, i) => {
                context.fillText(line, canvas.width / 2, startY + i * lineHeight);
            });
            
            // Create texture from canvas
            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(material);
            
            sprite.scale.set(0.25, 0.125, 1);
            sprite.position.set(0, -0.15, 0); // Below the line drawing
            
            parentGroup.add(sprite);
        }
        
        // NOTE: Second target (middle) is initialized when user completes first target
        // Third target (building) is initialized when reaching second target scene 3 (guide)
        // This optimizes performance by not tracking targets until needed

        // ============ START ============
        // ============ START AR ============
        await mindarThree.start();
        
        // NOTE: Second anchor initializes when user clicks next after completing first target
        // Third anchor initializes when reaching second target scene 3 (guide scene)
        
        // Animation mixer for updating animations
        const clock = new THREE.Clock();
        
        // Constant smoothing parameter - applied at all distances
        // Lower value = smoother but slightly more lag
        // Higher value = more responsive but more jitter
        const smoothingAlpha = 0.08; // Optimized balance: minimal jitter with acceptable lag
        const thirdSmoothingAlpha = 0.06; // Slightly stronger smoothing for real-scene third target
        
        // Helper matrices and vectors for world transform extraction
        const anchorWorldPosition = new THREE.Vector3();
        const anchorWorldQuaternion = new THREE.Quaternion();
        const anchorWorldScale = new THREE.Vector3();
        
        const secondAnchorWorldPosition = new THREE.Vector3();
        const secondAnchorWorldQuaternion = new THREE.Quaternion();
        const secondAnchorWorldScale = new THREE.Vector3();
        
        const thirdAnchorWorldPosition = new THREE.Vector3();
        const thirdAnchorWorldQuaternion = new THREE.Quaternion();
        const thirdAnchorWorldScale = new THREE.Vector3();
        
        renderer.setAnimationLoop(() => {
            const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to prevent large jumps
            
            // Apply constant smoothing to first target
            if (targetFound) {
                // CRITICAL: Ensure other targets' models are always hidden when first target is active
                if (!secondTargetActive && !thirdTargetActive) {
                    secondModels.forEach(m => { if (m) m.visible = false; });
                    thirdModels.forEach(m => { if (m) m.visible = false; });
                }
                
                // Extract world transform from anchor
                anchor.group.getWorldPosition(anchorWorldPosition);
                anchor.group.getWorldQuaternion(anchorWorldQuaternion);
                anchor.group.getWorldScale(anchorWorldScale);
                
                // Smoothly interpolate smoothed group to match anchor's world transform
                smoothed.position.lerp(anchorWorldPosition, smoothingAlpha);
                smoothed.quaternion.slerp(anchorWorldQuaternion, smoothingAlpha);
                smoothed.scale.lerp(anchorWorldScale, smoothingAlpha);
            }
            
            // Apply constant smoothing to second target (middle target)
            // Only update if second target is actually active
            if (secondTargetActive && secondTargetFound && secondSmoothed && secondAnchor) {
                // Extract world transform from second anchor
                secondAnchor.group.getWorldPosition(secondAnchorWorldPosition);
                secondAnchor.group.getWorldQuaternion(secondAnchorWorldQuaternion);
                secondAnchor.group.getWorldScale(secondAnchorWorldScale);
                
                // Smoothly interpolate second smoothed group to match second anchor's world transform
                secondSmoothed.position.lerp(secondAnchorWorldPosition, smoothingAlpha);
                secondSmoothed.quaternion.slerp(secondAnchorWorldQuaternion, smoothingAlpha);
                secondSmoothed.scale.lerp(secondAnchorWorldScale, smoothingAlpha);
            }
            
            // Update all animation mixers for first target
            models.forEach(model => {
                if (model && model.visible) { // Only update visible models
                    model.traverse((child) => {
                        if (child.userData.mixers) {
                            child.userData.mixers.forEach(mixer => {
                                mixer.update(delta);
                            });
                        }
                    });
                }
            });
            
            // Apply constant smoothing to third target
            // Only update if third target is actually active
            if (thirdTargetActive && thirdTargetFound && thirdSmoothed && thirdAnchor) {
                // Extract world transform from third anchor
                thirdAnchor.group.getWorldPosition(thirdAnchorWorldPosition);
                thirdAnchor.group.getWorldQuaternion(thirdAnchorWorldQuaternion);
                thirdAnchor.group.getWorldScale(thirdAnchorWorldScale);
                
                // Smoothly interpolate third smoothed group to match third anchor's world transform
                thirdSmoothed.position.lerp(thirdAnchorWorldPosition, thirdSmoothingAlpha);
                thirdSmoothed.quaternion.slerp(thirdAnchorWorldQuaternion, thirdSmoothingAlpha);
                thirdSmoothed.scale.lerp(thirdAnchorWorldScale, thirdSmoothingAlpha);
            }
            
            // Update all animation mixers for second target
            // Only update if second target is actually active
            if (secondTargetActive && secondTargetFound) {
                secondModels.forEach(model => {
                    if (model && model.visible) { // Only update visible models
                        model.traverse((child) => {
                            if (child.userData.mixers) {
                                child.userData.mixers.forEach(mixer => {
                                    mixer.update(delta);
                                });
                            }
                        });
                    }
                });
            } else {
                // Ensure second target models are hidden if second target is not active
                secondModels.forEach(m => { if (m) m.visible = false; });
            }
            
            // Update all animation mixers for third target
            // Only update if third target is actually active
            if (thirdTargetActive && thirdTargetFound) {
                thirdModels.forEach(model => {
                    if (model && model.visible) { // Only update visible models
                        model.traverse((child) => {
                            if (child.userData.mixers) {
                                child.userData.mixers.forEach(mixer => {
                                    mixer.update(delta);
                                });
                            }
                        });
                    }
                });
            } else {
                // Ensure third target models are hidden if third target is not active
                thirdModels.forEach(m => { if (m) m.visible = false; });
            }
            
            renderer.render(scene, camera);
        });

        // Debug helper - expose to global scope for testing
        window.debugAR = {
            testCompositeSlots: () => {
                console.log('Testing composite slots...');
                if (slotControllers[1]) {
                    console.log('Triggering composite slot onEnter...');
                    slotControllers[1].onEnter();
                }
            },
            getSlotState: () => {
                console.log('Current slot state:');
                console.log('Active slot:', index);
                console.log('Slot controllers:', slotControllers.map((c, i) => ({ slot: i, hasController: !!c })));
            }
        };

        // ---------- helpers ----------
        function createHUD() {
            const hud = document.createElement('div');
            hud.className = 'hud';
            hud.id = 'hud';
            hud.hidden = true;
            hud.innerHTML = `
                <button id="prev" class="arrow" aria-label="Previous">◀</button>
                <div class="label" id="label">0/0</div>
                <button id="replay" class="arrow replay-btn" aria-label="Replay">↻</button>
                <button id="next" class="arrow" aria-label="Next">▶</button>
            `;
            document.body.appendChild(hud);
            return {
                hud,
                prevB: hud.querySelector('#prev'),
                nextB: hud.querySelector('#next'),
                replayB: hud.querySelector('#replay'),
                label: hud.querySelector('#label')
            };
        }
        
        function createInfoButton() {
            const infoB = document.createElement('button');
            infoB.id = 'info-btn';
            infoB.className = 'info-btn';
            infoB.setAttribute('aria-label', 'Information');
            infoB.textContent = 'i';
            infoB.style.display = 'none'; // Initially hidden
            document.body.appendChild(infoB);
            return { infoB };
        }
        
        function createInfoModal() {
            const modal = document.createElement('div');
            modal.id = 'info-modal';
            modal.style.cssText = `
                position: fixed;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                pointer-events: none;
                transition: opacity 0.3s ease;
                opacity: 0;
            `;
            
            // Container for close button and content
            const container = document.createElement('div');
            container.style.cssText = `
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                pointer-events: auto;
            `;
            
            // Wrapper for close button to match content width (including padding)
            const buttonWrapper = document.createElement('div');
            buttonWrapper.style.cssText = `
                max-width: min(400px, 85vw);
                width: 100%;
                display: flex;
                justify-content: flex-end;
                margin-bottom: 12px;
                padding-right: 0;
                box-sizing: border-box;
            `;
            
            // Close button - positioned above the content, aligned to right
            const closeBtn = document.createElement('button');
            closeBtn.id = 'info-close';
            closeBtn.innerHTML = '×';
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.style.cssText = `
                width: 28px;
                height: 28px;
                border: 0;
                border-radius: 50%;
                padding: 0;
                font-size: 20px;
                font-weight: bold;
                background: rgba(255,255,255,.92);
                color: #333;
                box-shadow: 0 6px 18px rgba(0,0,0,.25);
                transition: opacity 0.3s ease, transform 0.2s ease, background 0.2s ease;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.transform = 'scale(1.05)';
                closeBtn.style.background = 'rgba(255,255,255,1)';
            });
            
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.transform = 'scale(1)';
                closeBtn.style.background = 'rgba(255,255,255,.92)';
            });
            
            closeBtn.addEventListener('mousedown', () => {
                closeBtn.style.transform = 'scale(0.95)';
            });
            
            closeBtn.addEventListener('mouseup', () => {
                closeBtn.style.transform = 'scale(1.05)';
            });
            
            const content = document.createElement('div');
            content.id = 'info-content';
            content.style.cssText = `
                max-width: min(400px, 85vw);
                max-height: min(60vh, 500px);
                padding: 32px 28px;
                border-radius: 16px;
                background: rgba(255, 255, 255, 0.95);
                color: #333;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                font-size: 16px;
                line-height: 1.6;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
                overflow-y: auto;
                box-sizing: border-box;
            `;
            
            buttonWrapper.appendChild(closeBtn);
            container.appendChild(buttonWrapper);
            container.appendChild(content);
            modal.appendChild(container);
            document.body.appendChild(modal);
            
            return {
                infoModal: modal,
                infoContent: content,
                infoCloseBtn: closeBtn
            };
        }

        function injectHUDStyles() {
            const css = `
                #ar-container { position: fixed; inset: 0; background: #000; }
                .hud {
                position: fixed;
                left: 0; right: 0;
                bottom: max(env(safe-area-inset-bottom), 16px);
                display: flex; gap: 12px; justify-content: center; align-items: center;
                pointer-events: none; /* let taps pass EXCEPT on buttons */
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                z-index: 9999;
                }
                .hud .arrow {
                pointer-events: auto;
                border: 0; border-radius: 999px; padding: 12px 16px;
                font-size: 18px; background: rgba(255,255,255,.92);
                box-shadow: 0 6px 18px rgba(0,0,0,.25);
                transition: opacity 0.3s ease, transform 0.2s ease;
                cursor: pointer;
                }
                .hud .arrow:hover:not(:disabled) {
                transform: scale(1.05);
                background: rgba(255,255,255,1);
                }
                .hud .arrow:active:not(:disabled) {
                transform: scale(0.95);
                }
                .hud .replay-btn {
                font-size: 20px;
                font-weight: bold;
                background: rgba(255,255,255,.92);
                color: #333;
                }
                .hud .replay-btn:hover:not(:disabled) {
                background: rgba(255,255,255,1);
                }
                .hud .arrow:disabled {
                pointer-events: none;
                cursor: not-allowed;
                }
                .hud .arrow:disabled:hover {
                transform: none;
                }
                .hud .label {
                pointer-events: none; color: #fff; font-weight: 700;
                text-shadow: 0 2px 8px rgba(0,0,0,.6);
                }
                #info-btn {
                position: fixed;
                top: max(env(safe-area-inset-top), 16px);
                right: max(env(safe-area-inset-right), 16px);
                z-index: 9999;
                pointer-events: auto;
                border: 0;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                padding: 0;
                font-size: 16px;
                font-weight: bold;
                background: rgba(255,255,255,.92);
                color: #333;
                box-shadow: 0 6px 18px rgba(0,0,0,.25);
                transition: opacity 0.3s ease, transform 0.2s ease, background 0.2s ease;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                }
                #info-btn:hover:not(:disabled) {
                transform: scale(1.05);
                background: rgba(255,255,255,1);
                }
                #info-btn:active:not(:disabled) {
                transform: scale(0.95);
                }
                #info-btn:disabled {
                pointer-events: none;
                cursor: not-allowed;
                }
                #info-btn:disabled:hover {
                transform: none;
                }
                canvas { touch-action: none; } /* improves mobile pointer behavior */
            `;
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }        
    }
    start();
});
// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resultsArea = document.getElementById('resultsArea');

    let currentImage = null; // To store the image-js object

    // --- UI Logic for Uploading ---
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#007bff'; });
    dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = '#ccc');
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.borderColor = '#ccc'; handleFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    function handleFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                // Load the TIFF using image-js
                const arrayBuffer = event.target.result;
                const image = await IJS.Image.load(arrayBuffer);
                currentImage = image; // Store for later analysis
                
                // Display the image on the canvas
                const roi = image.getRGBAData(); // Convert to RGBA for canvas rendering
                const imgData = new ImageData(roi, image.width, image.height);
                canvas.width = image.width;
                canvas.height = image.height;
                ctx.putImageData(imgData, 0, 0);
                
                analyzeBtn.disabled = false;
                resultsArea.innerHTML = '<p>✅ Image loaded. Click "Analyze Cells" to start.</p>';
            } catch (err) {
                console.error(err);
                resultsArea.innerHTML = '<p style="color:red;">❌ Error loading TIFF. Ensure it is a valid 8-bit or 16-bit greyscale image.</p>';
                analyzeBtn.disabled = true;
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // --- Analysis Logic ---
    analyzeBtn.addEventListener('click', () => {
        if (!currentImage) return;
        resultsArea.innerHTML = '<p>⏳ Processing image, please wait...</p>';
        
        // Run analysis in a setTimeout to keep UI responsive
        setTimeout(() => {
            try {
                // 1. Convert to Grey (if not already)
                let greyImg = currentImage;
                if (greyImg.components === 3) {
                    greyImg = greyImg.grey();
                }

                // 2. Thresholding: Create a binary mask (black and white)
                let binary = greyImg.mask({
                    algorithm: (data) => { // Simple global threshold
                        let threshold = 0.6; // 60% intensity. User could adjust this later.
                        for (let i = 0; i < data.length; i++) {
                            data[i] = data[i] > threshold ? 1 : 0;
                        }
                        return data;
                    }
                });

                // 3. Count objects (cells) and get their properties
                const roiManager = binary.getRoiManager();
                const rois = roiManager.getRois(); // Get all distinct objects
                
                // Filter out noise: remove objects smaller than 10 pixels
                const minCellSize = 10;
                const cells = rois.filter(roi => roi.surface >= minCellSize);
                
                // 4. Generate Results Table
                let totalCells = cells.length;
                let tableHTML = `<div class="result-stats">🔬 Total Cells Detected: <strong>${totalCells}</strong></div>`;
                tableHTML += `<table><thead><tr><th>Cell #</th><th>Area (px²)</th><th>Perimeter (px)</th><th>Circularity</th></tr></thead><tbody>`;
                
                cells.forEach((cell, idx) => {
                    const perimeter = cell.getPerimeter();
                    const area = cell.surface;
                    let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
                    circularity = Math.min(1, circularity.toFixed(3)); // Cap at 1
                    
                    tableHTML += `<tr>
                        <td>${idx+1}</td>
                        <td>${area}</td>
                        <td>${perimeter.toFixed(2)}</td>
                        <td>${circularity}</td>
                    </tr>`;
                });
                tableHTML += `</tbody></table>`;
                
                // Draw outlines on the canvas to show what was counted
                const overlayCanvas = document.createElement('canvas');
                overlayCanvas.width = currentImage.width;
                overlayCanvas.height = currentImage.height;
                const overlayCtx = overlayCanvas.getContext('2d');
                const roiData = currentImage.getRGBAData();
                const overlayImgData = new ImageData(roiData, currentImage.width, currentImage.height);
                overlayCtx.putImageData(overlayImgData, 0, 0);
                
                overlayCtx.strokeStyle = '#ff0000';
                overlayCtx.lineWidth = 2;
                cells.forEach(cell => {
                    const points = cell.externalContour; // Get boundary points
                    if (points && points.length > 2) {
                        overlayCtx.beginPath();
                        overlayCtx.moveTo(points[0].col, points[0].row);
                        for (let i = 1; i < points.length; i++) {
                            overlayCtx.lineTo(points[i].col, points[i].row);
                        }
                        overlayCtx.closePath();
                        overlayCtx.stroke();
                    }
                });
                ctx.putImageData(overlayCtx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
                
                resultsArea.innerHTML = tableHTML;
            } catch (err) {
                console.error(err);
                resultsArea.innerHTML = '<p style="color:red;">❌ Analysis failed. Try adjusting the image contrast or ensure it shows distinct cells.</p>';
            }
        }, 50);
    });
});

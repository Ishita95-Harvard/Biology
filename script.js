document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn');
    const resultsArea = document.getElementById('resultsArea');
    const thresholdSlider = document.getElementById('thresholdSlider');
    const thresholdValue = document.getElementById('thresholdValue');

    let currentImage = null;
    let originalImageData = null; // Store original for reset

    // Update threshold display
    thresholdSlider.addEventListener('input', (e) => {
        thresholdValue.textContent = e.target.value;
    });

    // Upload handlers
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { 
        e.preventDefault(); 
        dropZone.style.borderColor = '#007bff'; 
        dropZone.style.background = '#f8f9fa';
    });
    dropZone.addEventListener('dragleave', () => { 
        dropZone.style.borderColor = '#ccc'; 
        dropZone.style.background = 'white';
    });
    dropZone.addEventListener('drop', (e) => { 
        e.preventDefault(); 
        dropZone.style.borderColor = '#ccc';
        dropZone.style.background = 'white';
        handleFile(e.dataTransfer.files[0]); 
    });
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    
    // Reset button
    resetBtn.addEventListener('click', () => {
        if (originalImageData) {
            ctx.putImageData(originalImageData, 0, 0);
            resultsArea.innerHTML = '<p>🔄 View reset. Click "Analyze Cells" to run detection again.</p>';
        }
    });

    async function handleFile(file) {
        if (!file) return;
        
        resultsArea.innerHTML = '<p>⏳ Loading image...</p>';
        
        try {
            // Try different loading methods based on file type
            let image;
            const fileExt = file.name.split('.').pop().toLowerCase();
            
            if (fileExt === 'tif' || fileExt === 'tiff') {
                // For TIFF files, use array buffer
                const arrayBuffer = await file.arrayBuffer();
                try {
                    image = await IJS.Image.load(arrayBuffer);
                } catch (tiffError) {
                    console.error('TIFF load error:', tiffError);
                    throw new Error('TIFF format not supported. Try converting to PNG or JPG first.');
                }
            } else {
                // For other formats, use blob URL
                const url = URL.createObjectURL(file);
                image = await IJS.Image.load(url);
                URL.revokeObjectURL(url);
            }
            
            currentImage = image;
            
            // Display the image
            const roi = image.getRGBAData();
            const imgData = new ImageData(roi, image.width, image.height);
            canvas.width = image.width;
            canvas.height = image.height;
            ctx.putImageData(imgData, 0, 0);
            
            // Store original for reset
            originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            analyzeBtn.disabled = false;
            resultsArea.innerHTML = `<div class="success">✅ Image loaded successfully!<br>
                                     📊 Dimensions: ${image.width} x ${image.height}<br>
                                     🎨 Type: ${image.components}-channel, ${image.bitDepth}-bit<br>
                                     Click "Analyze Cells" to begin.</div>`;
        } catch (err) {
            console.error('Load error:', err);
            resultsArea.innerHTML = `<div class="error">❌ Error loading image: ${err.message}<br><br>
                                     <strong>Tips:</strong><br>
                                     • Try converting your TIFF to PNG or JPG format first<br>
                                     • Ensure the image isn't corrupted<br>
                                     • Try a different image file<br><br>
                                     <strong>Quick conversion:</strong> Use any online converter (like CloudConvert) to convert TIFF → PNG</div>`;
            analyzeBtn.disabled = true;
            currentImage = null;
        }
    }

    analyzeBtn.addEventListener('click', () => {
        if (!currentImage) {
            resultsArea.innerHTML = '<div class="error">❌ No image loaded. Please upload an image first.</div>';
            return;
        }
        
        resultsArea.innerHTML = '<p>⏳ Processing image, please wait...</p>';
        
        setTimeout(() => {
            try {
                // Convert to greyscale
                let greyImg = currentImage;
                if (greyImg.components === 3 || greyImg.components === 4) {
                    greyImg = greyImg.grey();
                }
                
                // Get threshold from slider
                const threshold = parseFloat(thresholdSlider.value);
                
                // Create binary mask
                const binary = greyImg.mask({
                    algorithm: (data) => {
                        for (let i = 0; i < data.length; i++) {
                            data[i] = data[i] > threshold ? 1 : 0;
                        }
                        return data;
                    }
                });
                
                // Find connected components (cells)
                const roiManager = binary.getRoiManager();
                const rois = roiManager.getRois();
                
                // Filter by size
                const minCellSize = 20; // Minimum pixels for a cell
                const maxCellSize = 5000; // Maximum pixels for a cell
                const cells = rois.filter(roi => 
                    roi.surface >= minCellSize && roi.surface <= maxCellSize
                );
                
                if (cells.length === 0) {
                    resultsArea.innerHTML = `<div class="info">🔍 No cells detected.<br><br>
                                             Try adjusting the sensitivity slider lower (e.g., 0.3-0.4) and click Analyze again.<br><br>
                                             <strong>Tips for better detection:</strong><br>
                                             • Ensure cells are clearly visible against background<br>
                                             • Try images with good contrast<br>
                                             • Adjust the sensitivity slider</div>`;
                    return;
                }
                
                // Generate results
                let totalCells = cells.length;
                let tableHTML = `<div class="result-stats">🔬 Total Cells Detected: <strong>${totalCells}</strong></div>`;
                tableHTML += `<div class="info">📐 Measurements are in pixels (px)</div>`;
                tableHTML += `<table><thead><tr><th>Cell #</th><th>Area (px²)</th><th>Perimeter (px)</th><th>Circularity</th><th>Width (px)</th><th>Height (px)</th></tr></thead><tbody>`;
                
                cells.forEach((cell, idx) => {
                    const perimeter = cell.getPerimeter();
                    const area = cell.surface;
                    let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
                    circularity = Math.min(1, Math.max(0, circularity.toFixed(3)));
                    
                    // Get bounding box dimensions
                    const minX = Math.min(...cell.points.map(p => p.col));
                    const maxX = Math.max(...cell.points.map(p => p.col));
                    const minY = Math.min(...cell.points.map(p => p.row));
                    const maxY = Math.max(...cell.points.map(p => p.row));
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    tableHTML += `<tr>
                        <td>${idx+1}</td>
                        <td>${area}</td>
                        <td>${perimeter.toFixed(2)}</td>
                        <td>${circularity}</td>
                        <td>${width}</td>
                        <td>${height}</td>
                    </tr>`;
                });
                tableHTML += `</tbody></table>`;
                
                // Draw outlines on the image
                const overlayCanvas = document.createElement('canvas');
                overlayCanvas.width = currentImage.width;
                overlayCanvas.height = currentImage.height;
                const overlayCtx = overlayCanvas.getContext('2d');
                const roiData = currentImage.getRGBAData();
                const overlayImgData = new ImageData(roiData, currentImage.width, currentImage.height);
                overlayCtx.putImageData(overlayImgData, 0, 0);
                
                // Draw colored outlines for each cell
                const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
                overlayCtx.lineWidth = 2;
                cells.forEach((cell, idx) => {
                    const color = colors[idx % colors.length];
                    overlayCtx.strokeStyle = color;
                    const points = cell.externalContour;
                    if (points && points.length > 2) {
                        overlayCtx.beginPath();
                        overlayCtx.moveTo(points[0].col, points[0].row);
                        for (let i = 1; i < points.length; i++) {
                            overlayCtx.lineTo(points[i].col, points[i].row);
                        }
                        overlayCtx.closePath();
                        overlayCtx.stroke();
                        
                        // Add cell number label
                        overlayCtx.fillStyle = color;
                        overlayCtx.font = 'bold 14px Arial';
                        overlayCtx.fillText(`${idx+1}`, points[0].col, points[0].row - 5);
                    }
                });
                
                ctx.putImageData(overlayCtx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
                resultsArea.innerHTML = tableHTML;
                
            } catch (err) {
                console.error('Analysis error:', err);
                resultsArea.innerHTML = `<div class="error">❌ Analysis failed: ${err.message}<br><br>
                                         Try these solutions:<br>
                                         • Adjust the sensitivity slider<br>
                                         • Use a simpler image (PNG or JPG)<br>
                                         • Ensure image has good contrast between cells and background</div>`;
            }
        }, 100);
    });
});

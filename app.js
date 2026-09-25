document.getElementById('analyze-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('image-upload');
    if (!fileInput.files.length) {
        alert('Please select an image first.');
        return;
    }
    
    const apiUrl = document.getElementById('api-url').value.trim();
    if (!apiUrl) {
        alert('Please provide the backend API URL.');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/predict`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('API Error: ' + response.statusText);
        
        const data = await response.json();
        document.getElementById('results').style.display = 'block';
        
        const verdictBox = document.getElementById('verdict');
        verdictBox.textContent = data.headline;
        verdictBox.className = 'verdict-box ' + (data.is_cover ? 'verdict-clean' : 'verdict-stego');
        
        document.getElementById('conf-val').textContent = (data.confidence * 100).toFixed(2) + '%';
        document.getElementById('clean-val').textContent = (data.p_clean * 100).toFixed(2) + '%';
        document.getElementById('threat-val').textContent = (data.total_threat * 100).toFixed(2) + '%';
        
    } catch (err) {
        alert('Analysis failed: ' + err.message);
    }
});

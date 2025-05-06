const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Set the root directory for designstamp.com
const rootDirectory = __dirname; // This will point to the directory where the script is located

// Set the directory containing the HTML files to be processed
const directoryPath = path.join(rootDirectory, 'work'); // Folder with HTML files

// Function to process each HTML file
const processHTMLFile = (filePath, outputFilePath) => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Could not read file ${filePath}: `, err);
      return;
    }

    // Load the HTML into cheerio
    const $ = cheerio.load(data);

    // Find all image tags with data-src (lazy loading) and placeholder images
    $('img[data-src]').each((index, element) => {
      const img = $(element);
      const realSrc = img.attr('data-src'); // Get the real source from data-src attribute

      // Replace data-src with the src attribute and add loading="lazy"
      img.attr('src', realSrc);
      img.attr('loading', 'lazy');

      // Optionally, you can remove the data-src attribute if not needed
      img.removeAttr('data-src');
    });

    // Save the modified HTML to a new file with '-1' appended to the original name
    fs.writeFile(outputFilePath, $.html(), 'utf8', (err) => {
      if (err) {
        console.error(`Could not write file ${outputFilePath}: `, err);
        return;
      }
      console.log(`Processed file: ${outputFilePath}`);
    });
  });
};

// Function to process all HTML files in the directory
const processAllFiles = (dirPath) => {
  fs.readdir(dirPath, (err, files) => {
    if (err) {
      console.error('Could not list directory: ', err);
      return;
    }

    // Filter out non-HTML files (you can adjust this filter based on your needs)
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    htmlFiles.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const outputFilePath = path.join(dirPath, `${path.parse(file).name}-1.html`);
      processHTMLFile(filePath, outputFilePath);
    });
  });
};

// Start processing all HTML files in the specified directory
processAllFiles(directoryPath);

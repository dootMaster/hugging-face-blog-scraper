const cheerio = require('cheerio');
const fs = require('fs').promises;
const { exec } = require('child_process');
const blessed = require('blessed');

const BASE_URL = 'https://huggingface.co';
const POSTS_FILE = 'blog-posts.json';
const STASH_FILE = 'stashed-posts.json';
const TAGS = [
  'transformer',
  'language',
  'model',
  'ai',
  'neural'
];

// Add variable to track last read article
let lastReadIndex = -1;

const WRAP_WIDTH = 100; // Increased from 80

const screen = blessed.screen({
  smartCSR: true,
  title: 'Hugging Face Blog Reader',
  fullUnicode: true  // Add this for better UTF-8 support
});

// Add this to handle program exit
screen.key(['C-c'], function() {
  process.exit(0);
});

function isEnglishTitle(text) {
  // Basic check for non-English characters (like Chinese, Japanese, Korean)
  return !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = [];
  let currentLength = 0;

  words.forEach(word => {
    if (currentLength + word.length + 1 > width) {
      lines.push(currentLine.join(' '));
      currentLine = [word];
      currentLength = word.length;
    } else {
      currentLine.push(word);
      currentLength += word.length + 1;
    }
  });

  if (currentLine.length > 0) {
    lines.push(currentLine.join(' '));
  }

  return lines.join('\n');
}

function sanitizeText(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'") // Smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // Smart double quotes
    .replace(/[\u2013\u2014]/g, '-') // En and em dashes
    .replace(/\u2026/g, '...') // Ellipsis
    .replace(/[^\x20-\x7E\n\r\t]/g, '') // Keep printable ASCII, newlines, returns, tabs
    .replace(/[ \t]+/g, ' ') // Normalize horizontal whitespace
    .replace(/\n\s*\n\s*\n+/g, '\n\n') // Normalize multiple blank lines to just two
    .trim();
}

async function fetchArticleContent(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const title = $('h1').first().text().trim();
    const date = $('time').first().text().trim();
    const author = $('a[href^="/@"]').first().text().trim();
    
    const content = [];
    $('.prose, article, .article-content, .content, main').find('p, h1, h2, h3, h4, li, pre, code').each((_, element) => {
      const tag = element.tagName;
      const text = $(element).text().trim();
      
      if (text) {
        switch(tag) {
          case 'h1':
            content.push(`\n\n# ${wrapText(text, WRAP_WIDTH)}\n`);
            break;
          case 'h2':
            content.push(`\n\n## ${wrapText(text, WRAP_WIDTH)}\n`);
            break;
          case 'h3':
          case 'h4':
            content.push(`\n\n### ${wrapText(text, WRAP_WIDTH)}\n`);
            break;
          case 'p':
            content.push(`\n${wrapText(text, WRAP_WIDTH)}\n\n`);
            break;
          case 'li':
            content.push(`  • ${wrapText(text, WRAP_WIDTH - 4)}\n`);
            break;
          case 'pre':
          case 'code':
            content.push(`\n    ${text}\n\n`);
            break;
          default:
            content.push(`${wrapText(text, WRAP_WIDTH)}\n\n`);
        }
      }
    });

    return {
      title: sanitizeText(wrapText(title, WRAP_WIDTH)),
      date,
      author: sanitizeText(author),
      content: content.join('\n')
    };
  } catch (error) {
    console.error('Error fetching article:', error.message);
    return null;
  }
}

async function fetchArticleTags(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Get tags from article page
    const tags = [];
    // Look for tags in more places
    $('a[href^="/blog/tags/"], a[href^="/tags/"], .tag, [data-tag]').each((_, element) => {
      const tag = $(element).text().trim().toLowerCase();
      if (tag) tags.push(tag);
    });
    
    console.log(`Found tags for ${url}:`, tags); // Debug log
    return tags;
  } catch (error) {
    console.error('Error fetching article tags:', error.message);
    return [];
  }
}

async function scrapeBlogPosts() {
  try {
    const response = await fetch(`${BASE_URL}/blog`);
    const html = await response.text();
    const $ = cheerio.load(html);

    console.log('Fetching blog posts...');

    const posts = [];
    $('a[href^="/blog/"]').each((_, element) => {
      const title = $(element).find('h4').text().trim();
      const link = BASE_URL + $(element).attr('href');
      const date = $(element).find('time').text().trim() || '';
      
      if (title && link && !link.includes('/tags/') && isEnglishTitle(title)) {
        posts.push({ title, link, date });
      }
    });

    const uniquePosts = Array.from(new Map(posts.map(post => [post.link, post])).values());
    await saveToJson(uniquePosts);
    console.log(`\nFound ${uniquePosts.length} blog posts`);
    return uniquePosts;
  } catch (error) {
    console.error('Error scraping blog posts:', error.message);
    throw error;
  }
}

async function saveToJson(posts) {
  try {
    await fs.writeFile(
      POSTS_FILE,
      JSON.stringify(posts, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.error('Error saving to JSON:', error.message);
    throw error;
  }
}

async function loadStashedPosts() {
  try {
    const data = await fs.readFile(STASH_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty array
    return [];
  }
}

async function saveStashedPosts(posts) {
  await fs.writeFile(STASH_FILE, JSON.stringify(posts, null, 2), 'utf-8');
}

async function displayStashMenu() {
  try {
    const stashedPosts = await loadStashedPosts();
    
    console.clear();
    console.log('\nStashed (Read) Articles:\n');
    stashedPosts.forEach((post, index) => {
      console.log(`${index + 1}. ${post.title}${post.date ? ` (${post.date})` : ''}`);
    });
    
    console.log('\nCommands:');
    console.log('- "u <number>" to unstash an article');
    console.log('- "d <number>" to delete an article');
    console.log('- "m" to return to main menu');
    console.log('- "q" to quit\n');

    rl.question('What would you like to do? ', async (answer) => {
      if (answer.toLowerCase() === 'q') {
        rl.close();
        return;
      }

      if (answer.toLowerCase() === 'm') {
        displayMenu();
        return;
      }

      if (answer.toLowerCase().startsWith('u ')) {
        const index = parseInt(answer.split(' ')[1]) - 1;
        if (index >= 0 && index < stashedPosts.length) {
          const unstagedPost = stashedPosts.splice(index, 1)[0];
          await saveStashedPosts(stashedPosts);
          
          const currentPosts = JSON.parse(await fs.readFile(POSTS_FILE, 'utf-8'));
          currentPosts.push(unstagedPost);
          await saveToJson(currentPosts);
          
          console.log('\nArticle unstashed!');
        }
        displayStashMenu();
        return;
      }

      if (answer.toLowerCase().startsWith('d ')) {
        const index = parseInt(answer.split(' ')[1]) - 1;
        if (index >= 0 && index < stashedPosts.length) {
          stashedPosts.splice(index, 1);
          await saveStashedPosts(stashedPosts);
          console.log('\nArticle deleted!');
        }
        displayStashMenu();
        return;
      }

      displayStashMenu();
    });
  } catch (error) {
    console.error('Error managing stashed posts:', error.message);
    throw error;
  }
}

async function displayMenu() {
  try {
    const data = await fs.readFile(POSTS_FILE, 'utf-8');
    const posts = JSON.parse(data);
    const stashedPosts = await loadStashedPosts();
    const stashedLinks = new Set(stashedPosts.map(post => post.link));
    
    const visiblePosts = posts.filter(post => !stashedLinks.has(post.link));
    
    const menu = blessed.box({
      top: 0,
      left: 'center',
      width: WRAP_WIDTH + 8,
      height: '100%',
      padding: 2,
      content: [
        '\nHugging Face Blog Posts:\n',
        ...visiblePosts.map((post, index) => 
          `${index + 1}. ${post.title}${post.date ? ` (${post.date})` : ''}\n`
        ),
        '\nCommands:',
        '- Enter number to read article',
        '- "s" to stash last read article',
        '- "s <number>" to stash specific article',
        '- "v" to view stashed articles',
        '- "q" to quit',
        '- "r" to refresh posts\n',
        lastReadIndex >= 0 ? `\nLast read: ${visiblePosts[lastReadIndex].title}\n` : '',
        '\nEnter command: '
      ].join('\n')
    });

    const input = blessed.textbox({
      bottom: 0,
      left: 'center',
      height: 1,
      width: WRAP_WIDTH + 8,
      keys: true,
      mouse: true,
      inputOnFocus: true
    });

    screen.append(menu);
    screen.append(input);
    input.focus();
    screen.render();

    // Handle input
    input.on('submit', async (value) => {
      if (value.toLowerCase() === 'q') {
        process.exit(0);
      }

      if (value.toLowerCase() === 'v') {
        displayStashMenu();
        return;
      }

      if (value.toLowerCase() === 'r') {
        await scrapeBlogPosts();
        lastReadIndex = -1; // Reset last read index on refresh
        displayMenu();
        return;
      }

      if (value.toLowerCase() === 's') {
        if (lastReadIndex >= 0 && lastReadIndex < visiblePosts.length) {
          stashedPosts.push(visiblePosts[lastReadIndex]);
          await saveStashedPosts(stashedPosts);
          console.log('\nLast read article stashed!');
          lastReadIndex = -1;
        } else {
          console.log('\nNo article has been read yet!');
        }
        displayMenu();
        return;
      }

      if (value.toLowerCase().startsWith('s ')) {
        const index = parseInt(value.split(' ')[1]) - 1;
        if (index >= 0 && index < visiblePosts.length) {
          stashedPosts.push(visiblePosts[index]);
          await saveStashedPosts(stashedPosts);
          console.log('\nArticle stashed!');
          if (index === lastReadIndex) lastReadIndex = -1;
        }
        displayMenu();
        return;
      }

      const selection = parseInt(value) - 1;
      if (selection >= 0 && selection < visiblePosts.length) {
        lastReadIndex = selection;
        console.clear();
        console.log('Loading article...');
        const article = await fetchArticleContent(visiblePosts[selection].link);
        
        if (article) {
          const content = blessed.box({
            top: 0,
            left: 'center',
            width: WRAP_WIDTH + 8,
            height: '100%',
            scrollable: true,
            alwaysScroll: true,
            keys: true,
            vi: true,
            scrollStep: 3,
            padding: {
              left: 2,
              right: 8,
              top: 1,
              bottom: 1
            },
            scrollbar: {
              ch: '█',
              track: {
                bg: 'black'
              },
              style: {
                fg: 'white'
              }
            },
            content: [
              '='.repeat(WRAP_WIDTH - 4),
              '',
              sanitizeText(article.title),
              `By ${sanitizeText(article.author)} - ${article.date}`,
              '',
              sanitizeText(article.content),
              '',
              '='.repeat(WRAP_WIDTH - 4),
              '',
              'Press q to return to menu'
            ].join('\n')
          });

          const scrollIndicator = blessed.box({
            parent: content,
            right: 8,
            bottom: 1,
            width: 6,
            height: 1,
            fixed: true,
            content: '  0%',
            style: {
              fg: 'white'
            }
          });

          content.on('scroll', () => {
            const maxScroll = Math.max(0, content.getScrollHeight() - content.height);
            const currentScroll = Math.min(maxScroll, content.getScroll());
            const percent = maxScroll > 0 ? Math.floor((currentScroll / maxScroll) * 100) : 0;
            const displayPercent = Math.min(100, Math.max(0, percent));
            scrollIndicator.setContent(`${displayPercent.toString().padStart(3)}%`);
            screen.render();
          });

          content.setScroll(0);

          content.key(['space'], () => {
            const maxScroll = content.getScrollHeight() - content.height;
            content.setScroll(Math.min(maxScroll, content.getScroll() + content.height));
            screen.render();
          });

          content.key(['b'], () => {
            content.setScroll(Math.max(0, content.getScroll() - content.height));
            screen.render();
          });

          content.key(['j'], () => {
            content.scroll(3);
            screen.render();
          });

          content.key(['k'], () => {
            content.scroll(-3);
            screen.render();
          });

          content.key(['j', 'k'], () => {
            screen.render();
          }, 'keyup');

          screen.append(content);
          content.focus();
          screen.render();

          await new Promise(resolve => {
            content.key(['q', 'escape'], () => {
              screen.remove(content);
              screen.render();
              resolve();
            });
          });
        }
      }
      displayMenu();
    });
  } catch (error) {
    console.error('Error reading posts:', error.message);
    throw error;
  }
}

scrapeBlogPosts().then(() => displayMenu()); 
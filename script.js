let coursesData = null;
let isDataLoaded = false;
let activeWindowId = 'browser-window';
let compulsoryClasses = [];
let electiveSections = [];
let electiveState = {
    allFiltered: [],
    renderedCount: 0,
    batchSize: 50,
    lastCourseNum: null,
    sortOrder: 'none',
    classFilter: 'all'
};

// Web Audio API Synthesizer for Retro 8-bit Sounds
const synth = {
    ctx: null,
    
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    
    playBeep(freq, duration, type = 'square', volume = 0.05) {
        this.init();
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        // Exponential decay
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    
    playClick() {
        this.playBeep(600, 0.08, 'triangle', 0.1);
    },
    
    playHover() {
        this.playBeep(880, 0.04, 'sine', 0.03);
    },
    
    playError() {
        this.playBeep(180, 0.15, 'sawtooth', 0.1);
        setTimeout(() => this.playBeep(150, 0.25, 'sawtooth', 0.1), 100);
    },
    
    playSuccess() {
        const now = this.ctx ? this.ctx.currentTime : 0;
        this.playBeep(523.25, 0.1, 'sine', 0.05); // C5
        setTimeout(() => this.playBeep(659.25, 0.1, 'sine', 0.05), 80); // E5
        setTimeout(() => this.playBeep(783.99, 0.1, 'sine', 0.05), 160); // G5
        setTimeout(() => this.playBeep(1046.50, 0.2, 'sine', 0.05), 240); // C6
    }
};

// Play sound helper that handles initial user gestures
function playSound(type) {
    try {
        if (type === 'click') synth.playClick();
        else if (type === 'hover') synth.playHover();
        else if (type === 'error') synth.playError();
        else if (type === 'success') synth.playSuccess();
    } catch (e) {
        console.log('Audio playback failed or blocked:', e);
    }
}

// Sound triggering for standard buttons
document.addEventListener('DOMContentLoaded', () => {
    // Add hover sound to buttons, tags and icons
    const hoverElements = '.win-btn, .browser-nav-btn, .query-btn, .tag-item, .desktop-icon, .start-btn, .start-menu-item, .dialog-btn, .suggestion-item, .draw-btn';
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest(hoverElements)) {
            playSound('hover');
        }
    });
    
    document.addEventListener('click', (e) => {
        if (e.target.closest(hoverElements)) {
            playSound('click');
        }
    });
    
    // Initialize drag-drop window listeners
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mousemove', drag);
    
    // Center browser window on startup without using CSS translate to prevent dragging jump
    const browserWin = document.getElementById('browser-window');
    if (browserWin) {
        const w = Math.min(window.innerWidth * 0.9, 1200);
        const h = window.innerHeight * 0.8;
        browserWin.style.width = `${w}px`;
        browserWin.style.height = `${h}px`;
        browserWin.style.left = `${(window.innerWidth - w) / 2}px`;
        browserWin.style.top = `${(window.innerHeight - h) / 2}px`;
        browserWin.style.transform = 'none';
    }
    
    // Boot loading sequence simulation
    simulateBoot();
    
    // Live clock update
    updateClock();
    setInterval(updateClock, 1000);
    
    // Click outside start menu to close
    document.addEventListener('click', (e) => {
        const startMenu = document.getElementById('start-menu');
        const startBtn = document.querySelector('.start-btn');
        if (startMenu.style.display === 'flex' && !startMenu.contains(e.target) && !startBtn.contains(e.target)) {
            toggleStartMenu();
        }
    });

    // Real-time Elective search input filtering listener
    const electiveSearchInput = document.getElementById('elective-search-input');
    if (electiveSearchInput) {
        electiveSearchInput.addEventListener('input', () => {
            applyElectiveFiltersAndSort();
        });
    }

    // Scroll listener for infinite scrolling in electives table wrapper
    const electivesWrapper = document.getElementById('electives-table-wrapper');
    if (electivesWrapper) {
        electivesWrapper.addEventListener('scroll', () => {
            const scrollTop = electivesWrapper.scrollTop;
            const clientHeight = electivesWrapper.clientHeight;
            const scrollHeight = electivesWrapper.scrollHeight;
            
            // If scrolled near bottom (within 20px), load more
            if (scrollTop + clientHeight >= scrollHeight - 20) {
                loadMoreElectives();
            }
        });
    }

    // Sort trigger by clicking the electives table header for student enrollment count
    const headerSelectNum = document.getElementById('header-select-num');
    if (headerSelectNum) {
        headerSelectNum.addEventListener('click', () => {
            toggleEnrollmentSort();
        });
    }

    // Filter trigger by selecting class count option in header dropdown
    const filterClasses = document.getElementById('filter-classes');
    if (filterClasses) {
        filterClasses.addEventListener('change', (e) => {
            electiveState.classFilter = e.target.value;
            applyElectiveFiltersAndSort();
        });
    }

    // Autocomplete events and dropdown closing
    const searchInput = document.getElementById('class-search-input');
    const autocompleteList = document.getElementById('autocomplete-list');
    
    if (searchInput && autocompleteList) {
        searchInput.addEventListener('input', () => {
            const val = searchInput.value.trim().toLowerCase();
            autocompleteList.innerHTML = '';
            
            if (!val) {
                autocompleteList.style.display = 'none';
                return;
            }
            
            const matches = compulsoryClasses.filter(c => c.toLowerCase().includes(val));
            if (matches.length === 0) {
                autocompleteList.style.display = 'none';
                return;
            }
            
            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                
                // Highlight query text inside suggestion
                const queryIdx = match.toLowerCase().indexOf(val);
                if (queryIdx >= 0) {
                    const before = match.substring(0, queryIdx);
                    const mid = match.substring(queryIdx, queryIdx + val.length);
                    const after = match.substring(queryIdx + val.length);
                    div.innerHTML = `${before}<span style="color: var(--pink-dark); font-weight: bold;">${mid}</span>${after}`;
                } else {
                    div.textContent = match;
                }
                
                div.addEventListener('click', () => {
                    searchInput.value = match;
                    autocompleteList.style.display = 'none';
                    performSearch();
                });
                autocompleteList.appendChild(div);
            });
            
            // Append warning tip if there are more than 10 matches
            if (matches.length > 10) {
                const tip = document.createElement('div');
                tip.className = 'suggestion-item-tip';
                tip.style.fontSize = '12px';
                tip.style.color = '#8c6adf';
                tip.style.textAlign = 'center';
                tip.style.background = '#fff8fc';
                tip.style.padding = '8px';
                tip.style.borderTop = '1px dashed var(--pink)';
                tip.style.cursor = 'default';
                tip.textContent = `还有 ${matches.length - 10} 个班级，请输入更精确的字词以筛选`;
                autocompleteList.appendChild(tip);
            }
            
            autocompleteList.style.display = 'block';
        });
        
        document.addEventListener('click', (e) => {
            if (e.target !== searchInput && e.target !== autocompleteList) {
                autocompleteList.style.display = 'none';
            }
        });
    }
    
    // Generate background aesthetic fragments
    generateBgFragments();
});

function updateClock() {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hrs}:${mins}`;
    
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
        clockEl.textContent = timeStr;
    }
    
    const mobileClock = document.getElementById('mobile-clock');
    if (mobileClock) {
        mobileClock.textContent = timeStr;
    }
}

// Generate aesthetic background floating block fragments
function generateBgFragments() {
    const desktop = document.getElementById('desktop');
    const colors = ['#f5b6dc', '#b28cf6', '#8dd9ff'];
    for (let i = 0; i < 15; i++) {
        const frag = document.createElement('div');
        frag.className = 'bg-fragment';
        const size = Math.floor(Math.random() * 12) + 6; // 6px to 18px
        const x = Math.floor(Math.random() * 95); // percentage
        const y = Math.floor(Math.random() * 88); // percentage
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        frag.style.width = `${size}px`;
        frag.style.height = `${size}px`;
        frag.style.left = `${x}%`;
        frag.style.top = `${y}%`;
        frag.style.background = color;
        frag.style.borderColor = '#8c6adf';
        frag.style.opacity = (Math.random() * 0.25 + 0.2).toFixed(2);
        
        // Add random floating delay
        frag.style.animation = `float ${Math.random() * 3 + 3}s ease-in-out infinite`;
        frag.style.animationDelay = `${Math.random() * 2}s`;
        
        desktop.appendChild(frag);
    }
}

// Windows Draggable Functionality
let isDragging = false;
let dragX, dragY;
let dragTargetId = null;

function dragStart(e, targetId) {
    // Only drag with left click
    if (e.button !== 0) return;
    
    // Set target window active
    setActiveWindow(targetId);
    
    const win = document.getElementById(targetId);
    if (win.classList.contains('maximized')) return; // No drag if maximized
    
    isDragging = true;
    dragTargetId = targetId;
    
    // Get cursor offset relative to window
    dragX = e.clientX - win.offsetLeft;
    dragY = e.clientY - win.offsetTop;
    
    // Add active styling
    win.style.opacity = '0.9';
}

function drag(e) {
    if (!isDragging) return;
    const win = document.getElementById(dragTargetId);
    
    // Calculate new position
    let newX = e.clientX - dragX;
    let newY = e.clientY - dragY;
    
    // Constrain within window boundaries
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 40;
    
    newX = Math.max(-100, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));
    
    win.style.left = `${newX}px`;
    win.style.top = `${newY}px`;
    win.style.transform = 'none'; // Clear translate-based centering once dragged
}

function dragEnd() {
    if (isDragging) {
        const win = document.getElementById(dragTargetId);
        if (win) {
            win.style.opacity = '1';
        }
        isDragging = false;
        dragTargetId = null;
    }
}

// Window Management Functions
function openWindow(id) {
    const win = document.getElementById(id);
    win.style.display = 'flex';
    
    // Show taskbar tab
    const taskTabId = id === 'browser-window' ? 'task-browser' : 
                      id === 'readme-window' ? 'task-readme' : 
                      id === 'electives-window' ? 'task-electives' : '';
    const tab = document.getElementById(taskTabId);
    if (tab) {
        tab.style.display = 'flex';
    }
    
    setActiveWindow(id);
}

function closeWindow(id) {
    const win = document.getElementById(id);
    win.style.display = 'none';
    
    // Hide taskbar tab
    const taskTabId = id === 'browser-window' ? 'task-browser' : 
                      id === 'readme-window' ? 'task-readme' : 
                      id === 'electives-window' ? 'task-electives' : '';
    const tab = document.getElementById(taskTabId);
    if (tab) {
        tab.style.display = 'none';
    }
}

function minimizeWindow(id) {
    const win = document.getElementById(id);
    win.style.display = 'none';
    
    // Deactivate taskbar tab
    const taskTabId = id === 'browser-window' ? 'task-browser' : 
                      id === 'readme-window' ? 'task-readme' : 
                      id === 'electives-window' ? 'task-electives' : '';
    const tab = document.getElementById(taskTabId);
    if (tab) {
        tab.classList.remove('active-task');
    }
}

function toggleMaximize(id) {
    const win = document.getElementById(id);
    const maxBtn = win.querySelector('.window-controls .win-btn:nth-child(2)');
    
    if (win.classList.contains('maximized')) {
        win.classList.remove('maximized');
        
        let w = 450;
        let h = 300;
        if (id === 'browser-window') {
            w = Math.min(window.innerWidth * 0.9, 1200);
            h = window.innerHeight * 0.8;
        } else if (id === 'electives-window') {
            w = 780;
            h = 520;
        }
        
        win.style.width = `${w}px`;
        win.style.height = `${h}px`;
        
        win.style.left = `${(window.innerWidth - w) / 2}px`;
        win.style.top = `${(window.innerHeight - h) / 2}px`;
        win.style.transform = 'none';
        
        // Restore standard maximize icon
        if (maxBtn) {
            maxBtn.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor" style="display:block;"><path d="M0,0 h10 v10 h-10 z M1,2 h8 v7 h-8 z" /></svg>';
        }
    } else {
        win.classList.add('maximized');
        win.style.width = '100%';
        win.style.height = 'calc(100vh - 40px)';
        win.style.top = '0';
        win.style.left = '0';
        win.style.transform = 'none';
        
        // Show restore icon (overlapping windows)
        if (maxBtn) {
            maxBtn.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor" style="display:block;"><path d="M2,0 h8 v8 h-2 v-6 h-6 z" /><path d="M0,2 h8 v8 h-8 z M1,4 h6 v5 h-6 z" /></svg>';
        }
    }
}

function toggleWindowFromTaskbar(id) {
    const win = document.getElementById(id);
    if (win.style.display === 'none') {
        win.style.display = 'flex';
        setActiveWindow(id);
    } else if (activeWindowId === id) {
        minimizeWindow(id);
    } else {
        setActiveWindow(id);
    }
}

function setActiveWindow(id) {
    activeWindowId = id;
    
    // Update window border shadow and z-index focus
    document.querySelectorAll('.window').forEach(w => {
        if (w.id === id) {
            w.classList.add('active-window');
        } else {
            w.classList.remove('active-window');
        }
    });
    
    // Update taskbar active tab indicators
    document.querySelectorAll('.task-item').forEach(t => {
        let matchingId = '';
        if (t.id === 'task-browser') matchingId = 'browser-window';
        else if (t.id === 'task-readme') matchingId = 'readme-window';
        else if (t.id === 'task-electives') matchingId = 'electives-window';
        
        if (matchingId === id) {
            t.classList.add('active-task');
        } else {
            t.classList.remove('active-task');
        }
    });
}

function toggleStartMenu() {
    const sm = document.getElementById('start-menu');
    if (sm.style.display === 'flex') {
        sm.style.display = 'none';
    } else {
        sm.style.display = 'flex';
    }
}

// Alert Dialog Box Functions
function showAlert(message) {
    playSound('error');
    const msgEl = document.getElementById('dialog-message');
    msgEl.textContent = message;
    document.getElementById('dialog-box').style.display = 'block';
}

function closeAlert() {
    document.getElementById('dialog-box').style.display = 'none';
}

// Fake System Boot and Data Fetching
function simulateBoot() {
    const fill = document.getElementById('loading-bar');
    const text = document.getElementById('loading-text');
    const bootContainer = document.getElementById('loading-container');
    const queryForm = document.getElementById('query-form');
    
    let progress = 0;
    
    // Start fetching JSON in background
    fetch('courses.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch courses data.');
            }
            return response.json();
        })
        .then(data => {
            coursesData = data;
            isDataLoaded = true;
            
            // Populate meta window
            document.getElementById('meta-semester').textContent = data.semester || '未知学期';
            document.getElementById('meta-fetched-at').textContent = data.fetched_at || '未知时间';
            document.getElementById('meta-total-courses').textContent = `${data.total_courses || 0} 个`;
            
            let collegeCount = 0;
            if (data.colleges && Array.isArray(data.colleges)) {
                collegeCount = data.colleges.length;
            }
            document.getElementById('meta-colleges-count').textContent = `${collegeCount} 个`;
            
            // Extract compulsory classes for autocomplete list
            initAutocomplete();
            
            // Initialize electives statistics & leaderboard
            initElectives();
        })
        .catch(err => {
            console.error(err);
            text.textContent = "BOOT ERROR: DATA LOAD FAILED";
            text.style.color = "red";
        });

    const interval = setInterval(() => {
        progress += Math.floor(Math.random() * 15) + 5;
        
        if (progress >= 100) {
            progress = 100;
            fill.style.width = '100%';
            
            if (isDataLoaded) {
                clearInterval(interval);
                setTimeout(() => {
                    bootContainer.style.display = 'none';
                    queryForm.style.display = 'block';
                    playSound('success');
                }, 200);
            } else {
                // Wait for the data to finish fetching
                text.textContent = "WAITING FOR DATABASE...";
            }
        } else {
            fill.style.width = `${progress}%`;
            if (progress < 40) {
                text.textContent = "PARSING DATA SHEETS...";
            } else if (progress < 80) {
                text.textContent = "LOADING INTERFACE ASSETS...";
            } else {
                text.textContent = "STARTING QUERY.EXE...";
            }
        }
    }, 120);
}

// Search Trigger Logic
function handleSearchKey(e) {
    if (e.key === 'Enter') {
        performSearch();
    }
}

function quickSearch(tag) {
    const input = document.getElementById('class-search-input');
    input.value = tag;
    performSearch();
}

function performSearch() {
    if (!isDataLoaded) {
        showAlert('系统数据库尚未加载完成，请稍候！');
        return;
    }
    
    const input = document.getElementById('class-search-input');
    const query = input.value.trim().toLowerCase();
    
    if (query === '') {
        showAlert('请输入班级名称进行查询！');
        return;
    }
    
    const resultsTable = document.getElementById('results-table');
    const tableBody = document.getElementById('table-body');
    const emptyState = document.getElementById('empty-state');
    const statCount = document.getElementById('query-result-count');
    
    // Clear previous results
    tableBody.innerHTML = '';
    
    const matches = [];
    
    // Filter matching courses
    coursesData.colleges.forEach(college => {
        college.courses.forEach(course => {
            // Strict query: Only show compulsory courses ('必修')
            if (course.nature && course.nature.includes('必修')) {
                const classesList = course.班级 || [];
                classesList.forEach(bj => {
                    const className = bj.班级名称 || '';
                    // Strict matching (case-insensitive exact equality)
                    if (className.toLowerCase() === query) {
                        matches.push({
                            college: college.college,
                            courseNum: course.course_num,
                            nature: course.nature,
                            title: course.info ? course.info.课程名称标识 : course.title,
                            className: className,
                            classSize: bj.班级人数 || '0',
                            teacher: bj.任课老师 || '待定',
                            hours: course.info ? course.info.周课时 : '0',
                            experiment: course.info ? course.info.周实验 : '0',
                            schedule: bj.排课说明 || '未安排',
                            status: bj.组班状态 || '暂无说明',
                            notes: bj.组班说明 || ''
                        });
                    }
                });
            }
        });
    });
    
    if (matches.length === 0) {
        resultsTable.style.display = 'none';
        statCount.style.display = 'none';
        emptyState.style.display = 'flex';
        
        // Custom error empty state message
        emptyState.querySelector('.empty-text').textContent = `未找到班级“${input.value}”的必修课，请检查输入或在下拉列表中选择！`;
        playSound('error');
        return;
    }
    
    // Populate Results Table
    matches.forEach(match => {
        const row = document.createElement('tr');
        
        // Course Nature Pill CSS class
        let natureClass = 'nature-pill compulsory'; // defaults to compulsory
        
        row.innerHTML = `
            <td>${match.college}</td>
            <td style="font-size: 15px; text-align: center;">${match.courseNum}</td>
            <td><strong>${match.title}</strong></td>
            <td style="text-align: center;"><span class="${natureClass}">${match.nature}</span></td>
            <td style="font-size: 15px; text-align: center;">${match.hours}</td>
            <td style="font-size: 15px; text-align: center;">${match.experiment}</td>
            <td style="font-size: 15px; text-align: center;">${match.classSize}</td>
            <td style="text-align: center;"><span style="font-size: 12px; color: var(--purple-dark);">${match.status}</span></td>
            <td style="text-align: center; font-size: 12px; color: var(--purple-dark);">${match.notes}</td>
            <td style="font-size: 13px;">${match.schedule}</td>
            <td style="text-align: center;">${match.teacher}</td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Toggle displays
    emptyState.style.display = 'none';
    resultsTable.style.display = 'table';
    statCount.textContent = `共找到 ${matches.length} 门必修课程`;
    statCount.style.display = 'inline-block';
    
    playSound('success');
}

// Utility function to highlight search match
function highlightText(source, query) {
    if (!query) return source;
    
    // Escape regex characters
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return source.replace(regex, '<span class="highlight">$1</span>');
}

// Interactive Super Cute Sound easter egg
function playSuperCuteSound() {
    // Play a lovely cute retro melody
    playSound('success');
    
    // Spawn 10 floating pink hearts on desktop
    const desktop = document.getElementById('desktop');
    for (let i = 0; i < 10; i++) {
        const heart = document.createElement('img');
        heart.src = 'assets/img/sprite_13_71x78.png';
        heart.className = 'deco-element';
        heart.style.width = '32px';
        heart.style.height = '32px';
        heart.style.left = `${Math.floor(Math.random() * 80) + 10}%`;
        heart.style.top = `${Math.floor(Math.random() * 60) + 20}%`;
        heart.style.animation = 'float 2s ease-in-out forwards';
        
        desktop.appendChild(heart);
        
        // Remove after animation completes
        setTimeout(() => {
            heart.remove();
        }, 2000);
    }
}

// Extract unique required class names for autocomplete selection list
function initAutocomplete() {
    const classSet = new Set();
    coursesData.colleges.forEach(college => {
        college.courses.forEach(course => {
            if (course.nature && course.nature.includes('必修')) {
                const classesList = course.班级 || [];
                classesList.forEach(bj => {
                    if (bj.班级名称) {
                        classSet.add(bj.班级名称);
                    }
                });
            }
        });
    });
    compulsoryClasses = Array.from(classSet).sort();
}

// Extract elective opening classes, including section capacity and selection count
function initElectives() {
    const list = [];
    coursesData.colleges.forEach(college => {
        college.courses.forEach(course => {
            if (course.nature && course.nature.includes('选修')) {
                const title = course.info ? (course.info.课程名称标识 || course.title) : course.title;
                const courseNum = course.course_num;
                
                const kaibanList = course.开班 || [];
                if (kaibanList.length === 0) {
                    list.push({
                        title: title,
                        courseNum: courseNum,
                        college: college.college,
                        teacher: '待定',
                        dept: college.college,
                        selectNum: '0',
                        classes: '--',
                        capacity: '无限制',
                        remarks: '无'
                    });
                } else {
                    kaibanList.forEach(kb => {
                        list.push({
                            title: title,
                            courseNum: courseNum,
                            college: college.college,
                            teacher: kb.任课老师姓名 || '待定',
                            dept: kb.任课老师所在单位 || college.college || '待定',
                            selectNum: kb.选课学生人数 || '0',
                            classes: kb.拟开班数 || '--',
                            capacity: kb.每班容量 || '无限制',
                            remarks: kb.排课说明 || '--'
                        });
                    });
                }
            }
        });
    });
    
    electiveSections = list;
    
    // Populate unique proposed classes filter dropdown
    const uniqueClasses = new Set();
    electiveSections.forEach(item => {
        if (item.classes && item.classes !== '--') {
            uniqueClasses.add(item.classes);
        }
    });
    const filterSelect = document.getElementById('filter-classes');
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">全部</option>';
        Array.from(uniqueClasses).sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return String(a).localeCompare(String(b));
        }).forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            filterSelect.appendChild(opt);
        });
        if (electiveSections.some(item => item.classes === '--')) {
            const opt = document.createElement('option');
            opt.value = '--';
            opt.textContent = '未指定';
            filterSelect.appendChild(opt);
        }
    }
    
    resetElectiveSearch();
}

// Reset electives query to clean initial state
function resetElectiveSearch() {
    electiveState.classFilter = 'all';
    electiveState.sortOrder = 'none';
    
    const filterSelect = document.getElementById('filter-classes');
    if (filterSelect) filterSelect.value = 'all';
    
    const indicator = document.getElementById('sort-indicator');
    if (indicator) indicator.textContent = '';
    
    applyElectiveFiltersAndSort();
}

// Combine search keyword filtering, class count filtering and student count sorting
function applyElectiveFiltersAndSort() {
    const searchInput = document.getElementById('elective-search-input');
    const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    // 1. Filter by search keyword
    let result = electiveSections;
    if (searchVal) {
        result = result.filter(item => 
            item.title.toLowerCase().includes(searchVal) || 
            item.teacher.toLowerCase().includes(searchVal) || 
            item.dept.toLowerCase().includes(searchVal) || 
            item.college.toLowerCase().includes(searchVal) || 
            item.courseNum.toLowerCase().includes(searchVal)
        );
    }
    
    // 2. Filter by proposed number of classes
    if (electiveState.classFilter !== 'all') {
        result = result.filter(item => item.classes === electiveState.classFilter);
    }
    
    // 3. Sort by student count
    if (electiveState.sortOrder !== 'none') {
        // Clone to avoid mutating original list order
        result = [...result];
        result.sort((a, b) => {
            const numA = parseInt(a.selectNum) || 0;
            const numB = parseInt(b.selectNum) || 0;
            return electiveState.sortOrder === 'desc' ? numB - numA : numA - numB;
        });
    }
    
    // 4. Reset pagination state and render
    electiveState.allFiltered = result;
    electiveState.renderedCount = 0;
    electiveState.lastCourseNum = null;
    
    const body = document.getElementById('electives-table-body');
    if (body) body.innerHTML = '';
    
    loadMoreElectives();
    updateElectiveCount(result.length);
}

// Toggle sort order between none, desc, and asc
function toggleEnrollmentSort() {
    const indicator = document.getElementById('sort-indicator');
    if (!indicator) return;
    
    if (electiveState.sortOrder === 'none') {
        electiveState.sortOrder = 'desc';
        indicator.textContent = ' [降序]';
    } else if (electiveState.sortOrder === 'desc') {
        electiveState.sortOrder = 'asc';
        indicator.textContent = ' [升序]';
    } else {
        electiveState.sortOrder = 'none';
        indicator.textContent = '';
    }
    
    applyElectiveFiltersAndSort();
}

// Load more electives (infinite scroll pagination batch)
function loadMoreElectives() {
    const body = document.getElementById('electives-table-body');
    if (!body) return;
    
    if (electiveState.allFiltered.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #b09dc9; padding: 24px; font-family: var(--font-cute);">没有找到匹配的选修课班次喵~</td></tr>`;
        return;
    }
    
    if (electiveState.renderedCount >= electiveState.allFiltered.length) {
        return;
    }
    
    // Remove the "more tip" row if it exists
    const existingTip = body.querySelector('.table-more-tip-row');
    if (existingTip) {
        existingTip.remove();
    }
    
    const start = electiveState.renderedCount;
    const end = Math.min(start + electiveState.batchSize, electiveState.allFiltered.length);
    const batch = electiveState.allFiltered.slice(start, end);
    
    batch.forEach(item => {
        // If course group has changed, insert a course header row
        if (item.courseNum !== electiveState.lastCourseNum) {
            const headerRow = document.createElement('tr');
            headerRow.className = 'course-group-row';
            headerRow.innerHTML = `
                <td colspan="6" style="background: #f7effd; font-weight: bold; color: #7f5bc7; font-family: var(--font-cute); padding: 8px 12px; border-bottom: 2px solid var(--pink-light);">
                    ${item.title} (课程号: ${item.courseNum} | 开课单位: ${item.college})
                </td>
            `;
            body.appendChild(headerRow);
            electiveState.lastCourseNum = item.courseNum;
        }
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${item.teacher}</strong></td>
            <td>${item.dept}</td>
            <td style="font-size: 14px; text-align: center; color: var(--pink-dark); font-weight: bold;">${item.selectNum}</td>
            <td style="font-size: 14px; text-align: center;">${item.classes}</td>
            <td style="font-size: 14px; text-align: center; color: var(--purple-dark);">${item.capacity}</td>
            <td style="font-size: 13px;">${item.remarks}</td>
        `;
        body.appendChild(row);
    });
    
    electiveState.renderedCount = end;
    
    // If there are still items left, append a new tip row
    if (electiveState.renderedCount < electiveState.allFiltered.length) {
        const remaining = electiveState.allFiltered.length - electiveState.renderedCount;
        const tipRow = document.createElement('tr');
        tipRow.className = 'table-more-tip-row';
        tipRow.innerHTML = `
            <td colspan="6" class="table-more-tip-row" style="text-align: center;">
                <div style="color: #8c6adf; background: #fff8fc; padding: 10px; font-family: var(--font-cute); font-size: 13px; border-top: 1px dashed var(--pink);">
                    还有 ${remaining} 个班次，向下滚动或输入更精确的字词筛选
                </div>
            </td>
        `;
        body.appendChild(tipRow);
    } else {
        const tipRow = document.createElement('tr');
        tipRow.className = 'table-more-tip-row';
        tipRow.innerHTML = `
            <td colspan="6" class="table-more-tip-row" style="text-align: center;">
                <div style="color: var(--pink-dark); background: #fff8fc; padding: 10px; font-family: var(--font-cute); font-size: 13px; border-top: 1px dashed var(--pink);">
                    已加载全部 ${electiveState.allFiltered.length} 个班次喵
                </div>
            </td>
        `;
        body.appendChild(tipRow);
    }
}

// Update elective query footer counts
function updateElectiveCount(cnt) {
    const el = document.getElementById('elective-total-stat');
    if (el) {
        el.textContent = `共找到 ${cnt} 门选修课班次`;
    }
}

// Start menu options: System Reset
function resetSystem() {
    const input = document.getElementById('class-search-input');
    if (input) input.value = '';
    
    const tableBody = document.getElementById('table-body');
    if (tableBody) tableBody.innerHTML = '';
    
    const resultsTable = document.getElementById('results-table');
    if (resultsTable) resultsTable.style.display = 'none';
    
    const statCount = document.getElementById('query-result-count');
    if (statCount) statCount.style.display = 'none';
    
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        emptyState.style.display = 'flex';
        emptyState.querySelector('.empty-text').textContent = '请输入班级名称并点击“查询”~';
    }
    
    // Reset electives search filter
    const elInput = document.getElementById('elective-search-input');
    if (elInput) elInput.value = '';
    resetElectiveSearch();
    
    playSound('success');
    showAlert('系统缓存已清理，回到初始状态！');
}

// Start menu options: Shutdown
function shutdownSystem() {
    playSound('error');
    
    // Create full screen shutdown overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = '#0a0518';
    overlay.style.color = '#e889c3';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.fontFamily = 'var(--font-cute)';
    overlay.style.cursor = 'pointer';
    
    overlay.innerHTML = `
        <img src="assets/img/sprite_2_268x246.png" style="width:100px; height:100px; image-rendering:pixelated; margin-bottom: 20px; animation: float 3s infinite;" alt="Heart">
        <h2 style="margin-bottom: 10px; font-size:24px;">IT IS TIME TO SLEEP...</h2>
        <p style="font-family: var(--font-pixel); font-size: 18px; color: #b28cf6;">双击屏幕任意位置重启系统</p>
    `;
    
    document.body.appendChild(overlay);
    
    // Double click to reboot
    overlay.addEventListener('dblclick', () => {
        overlay.remove();
        playSound('success');
        location.reload();
    });
}

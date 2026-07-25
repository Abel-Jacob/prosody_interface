import sys

def parse_webm_sizes(filename):
    with open(filename, 'rb') as f:
        data = f.read()
    
    # Let's find exactly how the bytes are laid out
    print(f"File size: {len(data)}")
    
    # We can look for the EBML header (1A 45 DF A3)
    idx = 0
    ebml = b'\x1a\x45\xdf\xa3'
    count = 0
    while True:
        idx = data.find(ebml, idx)
        if idx == -1:
            break
        print(f"Found EBML header at {idx}")
        count += 1
        idx += 4
        
    print(f"Total EBML headers: {count}")

if __name__ == '__main__':
    parse_webm_sizes(sys.argv[1])
